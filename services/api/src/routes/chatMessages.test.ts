import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { ChatMessagePage, ChatPhotoUploadResponse, ChatSendMessageResponse } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import { _resetChatPersistenceForTests, deleteChatDataForUser, listChatPushDevicesForUsers } from "../lib/chatPersistence.js";
import { _resetChatMessageStoreForTests, setChatInsertCommitDelayForTests } from "../lib/chatMessageStore.js";
import { chatRoomWaiterCount } from "../lib/chatLive.js";
import { resetChatPushTransport, setChatPushTransport, type ChatPushDispatchInput } from "../lib/chatPushDispatch.js";
import { _settleChatPushForTests } from "./chatRoutes.js";
import { runChatRetentionPass } from "../lib/chatRetention.js";
import { getRoomPersistenceMode } from "../lib/roomPersistence.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type App = ReturnType<typeof buildApp>;

function claims(sub: string) {
  return { sub, teamIds: ["team-chat"], roomRoles: {} };
}

async function createRoom(app: App, ownerToken: string, ownerSub: string): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-chat", athleteId: ownerSub, name: "Leadville 100", creatorRole: "athlete" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(created.statusCode, 201);
  const roomId = (created.json() as { id: string }).id;
  const pay = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(pay.statusCode, 200);
  const activate = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 42.0, longitude: -70.0 },
          { id: "cp1", latitude: 42.01, longitude: -70.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 42.0, longitude: -70.0 },
        { latitude: 42.01, longitude: -70.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(activate.statusCode, 200);
  return roomId;
}

async function addMember(app: App, roomId: string, ownerToken: string, memberToken: string, name: string) {
  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: `${name.toLowerCase()}@example.com`, role: "crew_member" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(invite.statusCode, 201);
  const accept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: (invite.json() as { token: string }).token },
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(accept.statusCode, 200);
  const sub = (app.jwt.decode(memberToken) as { sub: string }).sub;
  const named = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/members/${encodeURIComponent(sub)}`,
    payload: { displayName: name },
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(named.statusCode, 200);
}

async function send(app: App, token: string, roomId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/chat/rooms/${roomId}/messages`,
    payload,
    headers: { authorization: `Bearer ${token}` }
  });
}

async function list(app: App, token: string, roomId: string, query = "") {
  return app.inject({
    method: "GET",
    url: `/chat/rooms/${roomId}/messages${query}`,
    headers: { authorization: `Bearer ${token}` }
  });
}

async function registerPush(app: App, token: string, deviceId: string, platform = "ios") {
  const res = await app.inject({
    method: "POST",
    url: "/chat/push/tokens",
    payload: { deviceId, platform, token: `tok-${deviceId}` },
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(res.statusCode, 201);
}

async function waitUntil(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

function capturePush(): ChatPushDispatchInput[] {
  const captured: ChatPushDispatchInput[] = [];
  setChatPushTransport(async (input) => {
    captured.push(input);
    return { delivered: input.targets.length, attempts: input.targets.length, failures: [], invalidDeviceIds: [] };
  });
  return captured;
}

async function withApp(fn: (app: App) => Promise<void>): Promise<void> {
  _resetChatPersistenceForTests();
  _resetChatMessageStoreForTests();
  resetChatPushTransport();
  const app = buildApp();
  await app.ready();
  try {
    await fn(app);
  } finally {
    await _settleChatPushForTests();
    resetChatPushTransport();
    await app.close();
  }
}

test("chat messages: a non-member can neither read nor post; signed-out is 401", async () => {
  await withApp(async (app) => {
    const owner = app.jwt.sign(claims("owner-nm"));
    const stranger = app.jwt.sign(claims("stranger-nm"));
    const roomId = await createRoom(app, owner, "owner-nm");
    assert.equal((await send(app, owner, roomId, { clientMessageId: "c1", text: "hi" })).statusCode, 201);
    assert.equal((await list(app, stranger, roomId)).statusCode, 403);
    assert.equal((await list(app, stranger, roomId, "?after=0&wait=1")).statusCode, 403);
    assert.equal((await send(app, stranger, roomId, { clientMessageId: "x", text: "let me in" })).statusCode, 403);
    const anon = await app.inject({ method: "GET", url: `/chat/rooms/${roomId}/messages` });
    assert.equal(anon.statusCode, 401);
    const photo = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/photos`,
      payload: Buffer.from([0xff, 0xd8, 0xff]),
      headers: { authorization: `Bearer ${stranger}`, "content-type": "image/jpeg" }
    });
    assert.equal(photo.statusCode, 403);
    const page = (await list(app, owner, roomId)).json() as ChatMessagePage;
    assert.equal(page.messages.length, 1, "the stranger's post was not stored");
  });
});

test("chat messages: a retried client message id is stored once", async () => {
  await withApp(async (app) => {
    const captured = capturePush();
    const owner = app.jwt.sign(claims("owner-dup"));
    const crew = app.jwt.sign(claims("crew-dup"));
    const roomId = await createRoom(app, owner, "owner-dup");
    await addMember(app, roomId, owner, crew, "Ada");
    await registerPush(app, crew, "crew-dup-phone");
    const first = await send(app, owner, roomId, { clientMessageId: "same", text: "aid 3 in 20" });
    const retry = await send(app, owner, roomId, { clientMessageId: "same", text: "aid 3 in 20" });
    assert.equal(first.statusCode, 201);
    assert.equal(retry.statusCode, 200);
    const a = first.json() as ChatSendMessageResponse;
    const b = retry.json() as ChatSendMessageResponse;
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true);
    assert.equal(a.message.id, b.message.id);
    // Same id from a different sender is a different message.
    assert.equal((await send(app, crew, roomId, { clientMessageId: "same", text: "copy" })).statusCode, 201);
    const page = (await list(app, owner, roomId)).json() as ChatMessagePage;
    assert.deepEqual(page.messages.map((m) => m.text), ["aid 3 in 20", "copy"]);
    await _settleChatPushForTests();
    assert.equal(captured.length, 1, "the retry does not push again (the crew's own message pushes nobody with a device)");
  });
});

test("chat messages: list pages oldest-first with cursors and member names", async () => {
  await withApp(async (app) => {
    const owner = app.jwt.sign(claims("owner-page"));
    const crew = app.jwt.sign(claims("crew-page"));
    const roomId = await createRoom(app, owner, "owner-page");
    await addMember(app, roomId, owner, crew, "Ada");
    const empty = (await list(app, owner, roomId)).json() as ChatMessagePage;
    assert.deepEqual(empty.messages, []);
    assert.equal(empty.latestCursor, "");
    assert.equal(empty.olderCursor, undefined);
    for (let i = 1; i <= 5; i += 1) {
      assert.equal((await send(app, i % 2 ? owner : crew, roomId, { clientMessageId: `m${i}`, text: `msg ${i}` })).statusCode, 201);
    }
    const latest = (await list(app, crew, roomId, "?limit=2")).json() as ChatMessagePage;
    assert.deepEqual(latest.messages.map((m) => m.text), ["msg 4", "msg 5"]);
    assert.equal(latest.selfUserId, "crew-page");
    assert.equal(latest.members.find((m) => m.userId === "crew-page")?.displayName, "Ada");
    assert.ok(latest.olderCursor);
    const older = (await list(app, crew, roomId, `?limit=2&before=${latest.olderCursor}`)).json() as ChatMessagePage;
    assert.deepEqual(older.messages.map((m) => m.text), ["msg 2", "msg 3"]);
    assert.equal(older.latestCursor, latest.latestCursor);
    const oldest = (await list(app, crew, roomId, `?limit=2&before=${older.olderCursor}`)).json() as ChatMessagePage;
    assert.deepEqual(oldest.messages.map((m) => m.text), ["msg 1"]);
    assert.equal(oldest.olderCursor, undefined);
    const newer = (await list(app, crew, roomId, `?after=${older.messages[1]!.id}`)).json() as ChatMessagePage;
    assert.deepEqual(newer.messages.map((m) => m.text), ["msg 4", "msg 5"]);
    assert.equal((await list(app, crew, roomId, "?after=1&before=3")).statusCode, 400);
    assert.equal((await list(app, crew, roomId, "?after=abc")).statusCode, 400);
  });
});

test(
  "chat messages: paging stays in send order when message ids gain a digit",
  { skip: getRoomPersistenceMode() !== "postgres" && "needs Postgres (test:pg)" },
  async () => {
    await withApp(async (app) => {
      const owner = app.jwt.sign(claims("owner-digits"));
      const roomId = await createRoom(app, owner, "owner-digits");
      const first = await send(app, owner, roomId, { clientMessageId: `d0-${Date.now()}`, text: "warm-up" });
      assert.equal(first.statusCode, 201);
      const firstId = Number((first.json() as ChatSendMessageResponse).message.id);

      // Move the id sequence forward so the next five messages straddle a power of ten (…98, 99, 100, 101, 102).
      let boundary = 10;
      while (boundary <= firstId + 3) boundary *= 10;
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await pool.query("SELECT setval(pg_get_serial_sequence('chat_messages', 'seq'), $1)", [boundary - 3]);
        await pageAcrossBoundary();
      } finally {
        // Put the sequence back so a reused database does not climb a power of ten on every run.
        await pool.query("DELETE FROM chat_messages WHERE room_id = $1", [roomId]);
        await pool.query(
          `SELECT setval(pg_get_serial_sequence('chat_messages', 'seq'),
                         GREATEST($1::bigint, (SELECT COALESCE(MAX(seq), 0) FROM chat_messages)))`,
          [firstId]
        );
        await pool.end();
      }

        async function pageAcrossBoundary(): Promise<void> {
        const ids: number[] = [];
        for (let i = 1; i <= 5; i += 1) {
          const sent = await send(app, owner, roomId, { clientMessageId: `d${i}-${Date.now()}`, text: `msg ${i}` });
          assert.equal(sent.statusCode, 201);
          ids.push(Number((sent.json() as ChatSendMessageResponse).message.id));
        }
        assert.deepEqual(ids, [boundary - 2, boundary - 1, boundary, boundary + 1, boundary + 2]);

        // Opening the chat shows the newest messages, not the ones with the shorter ids.
        const latest = (await list(app, owner, roomId, "?limit=2")).json() as ChatMessagePage;
        assert.deepEqual(latest.messages.map((m) => m.text), ["msg 4", "msg 5"]);
        assert.equal(latest.latestCursor, String(boundary + 2));
        // Scrolling back and catching up both walk the messages in send order.
        const older = (await list(app, owner, roomId, `?limit=2&before=${latest.olderCursor}`)).json() as ChatMessagePage;
        assert.deepEqual(older.messages.map((m) => m.text), ["msg 2", "msg 3"]);
        const catchUp = (await list(app, owner, roomId, `?after=${firstId}&limit=3`)).json() as ChatMessagePage;
        assert.deepEqual(catchUp.messages.map((m) => m.text), ["msg 1", "msg 2", "msg 3"]);
        assert.equal(catchUp.latestCursor, String(boundary));
        }
    });
  }
);

test(
  "chat messages: a crew phone following the cursor gets both of two sends that commit out of order",
  { skip: getRoomPersistenceMode() !== "postgres" && "needs Postgres (test:pg)" },
  async () => {
    await withApp(async (app) => {
      const owner = app.jwt.sign(claims("owner-overlap"));
      const crew = app.jwt.sign(claims("crew-overlap"));
      const roomId = await createRoom(app, owner, "owner-overlap");
      await addMember(app, roomId, owner, crew, "Pacer");
      const opened = (await list(app, crew, roomId)).json() as ChatMessagePage;
      const startCursor = opened.latestCursor || "0";

      // The runner's send takes its id first but is still committing when the crew's send lands.
      let paused = false;
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      setChatInsertCommitDelayForTests(async () => {
        paused = true;
        await held;
      });
      const first = send(app, owner, roomId, { clientMessageId: "overlap-a", text: "at the aid station" });
      await waitUntil(() => paused, "first send to hold before commit");
      const second = send(app, crew, roomId, { clientMessageId: "overlap-b", text: "on my way" });
      await Promise.race([second, new Promise((r) => setTimeout(r, 500))]);

      // A crew phone polls in that moment, then keeps following the cursor it was given.
      const during = (await list(app, crew, roomId, `?after=${startCursor}`)).json() as ChatMessagePage;
      release();
      assert.equal((await first).statusCode, 201);
      assert.equal((await second).statusCode, 201);
      const next = during.latestCursor || startCursor;
      const after = (await list(app, crew, roomId, `?after=${next}`)).json() as ChatMessagePage;

      const seen = [...during.messages, ...after.messages].map((m) => m.text).sort();
      assert.deepEqual(seen, ["at the aid station", "on my way"]);
    });
  }
);

test("chat messages: a long-poll wakes when a crew member posts", async () => {
  await withApp(async (app) => {
    const owner = app.jwt.sign(claims("owner-live"));
    const crew = app.jwt.sign(claims("crew-live"));
    const roomId = await createRoom(app, owner, "owner-live");
    await addMember(app, roomId, owner, crew, "Ada");
    const start = (await list(app, crew, roomId)).json() as ChatMessagePage;
    const started = Date.now();
    const poll = list(app, crew, roomId, `?after=${start.latestCursor || "0"}&wait=20`);
    await waitUntil(() => chatRoomWaiterCount(roomId) > 0, "the poll to park");
    assert.equal((await send(app, owner, roomId, { clientMessageId: "live-1", text: "leaving aid 2" })).statusCode, 201);
    const res = await poll;
    assert.equal(res.statusCode, 200);
    const page = res.json() as ChatMessagePage;
    assert.deepEqual(page.messages.map((m) => m.text), ["leaving aid 2"]);
    assert.equal(page.latestCursor, page.messages[0]!.id);
    assert.ok(Date.now() - started < 5000, "woke on the post, not the timeout");
    assert.equal(chatRoomWaiterCount(roomId), 0);
  });
});

test("chat messages: a long-poll with nothing new returns empty after the wait", async () => {
  await withApp(async (app) => {
    const owner = app.jwt.sign(claims("owner-idle"));
    const roomId = await createRoom(app, owner, "owner-idle");
    const res = await list(app, owner, roomId, "?after=0&wait=1");
    assert.equal(res.statusCode, 200);
    const page = res.json() as ChatMessagePage;
    assert.deepEqual(page.messages, []);
    assert.equal(page.latestCursor, "0");
    assert.equal((await list(app, owner, roomId, "?after=0&wait=26")).statusCode, 400);
  });
});

test("chat messages: removing a member closes their open poll and refuses their posts", async () => {
  await withApp(async (app) => {
    const owner = app.jwt.sign(claims("owner-rm"));
    const crew = app.jwt.sign(claims("crew-rm"));
    const roomId = await createRoom(app, owner, "owner-rm");
    await addMember(app, roomId, owner, crew, "Ada");
    const poll = list(app, crew, roomId, "?after=0&wait=20");
    await waitUntil(() => chatRoomWaiterCount(roomId) > 0, "the poll to park");
    const removed = await app.inject({
      method: "DELETE",
      url: `/race-rooms/${roomId}/members/crew-rm`,
      headers: { authorization: `Bearer ${owner}` }
    });
    assert.equal(removed.statusCode, 200);
    assert.equal((await poll).statusCode, 403);
    assert.equal((await send(app, crew, roomId, { clientMessageId: "late", text: "still here?" })).statusCode, 403);
  });
});

test("chat messages: push honours prefs, mentions, and skips the sender", async () => {
  await withApp(async (app) => {
    const captured = capturePush();
    const owner = app.jwt.sign(claims("owner-push"));
    const ada = app.jwt.sign(claims("ada-push"));
    const bo = app.jwt.sign(claims("bo-push"));
    const roomId = await createRoom(app, owner, "owner-push");
    await addMember(app, roomId, owner, ada, "Ada");
    await addMember(app, roomId, owner, bo, "Bo");
    await registerPush(app, owner, "owner-phone");
    await registerPush(app, ada, "ada-phone", "android");
    await registerPush(app, bo, "bo-phone");
    const mute = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      payload: { preference: "none" },
      headers: { authorization: `Bearer ${bo}` }
    });
    assert.equal(mute.statusCode, 200);
    const mentionsOnly = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      payload: { preference: "mentions" },
      headers: { authorization: `Bearer ${ada}` }
    });
    assert.equal(mentionsOnly.statusCode, 200);

    await send(app, owner, roomId, { clientMessageId: "p1", text: "plain update" });
    await _settleChatPushForTests();
    assert.equal(captured.length, 0, "muted Bo and mentions-only Ada get nothing");

    await send(app, owner, roomId, { clientMessageId: "p2", text: "@ada bring the headlamp" });
    await _settleChatPushForTests();
    assert.equal(captured.length, 1);
    const push = captured[0]!;
    assert.deepEqual(push.targets.map((t) => t.deviceId), ["ada-phone"]);
    assert.equal(push.title, "Leadville 100");
    assert.equal(push.kind, "chat");
    assert.equal(push.roomId, roomId);
    assert.match(push.body, /bring the headlamp/);

    await send(app, ada, roomId, { clientMessageId: "p3", text: "on it" });
    await _settleChatPushForTests();
    assert.deepEqual(captured[1]?.targets.map((t) => t.deviceId), ["owner-phone"]);
    assert.equal(captured[1]?.body, "Ada: on it");
  });
});

test("chat messages: a token the provider rejects is pruned", async () => {
  await withApp(async (app) => {
    setChatPushTransport(async (input) => ({
      delivered: 0,
      attempts: input.targets.length,
      failures: input.targets.map((t) => ({ deviceId: t.deviceId, reason: "Unregistered" })),
      invalidDeviceIds: input.targets.map((t) => t.deviceId)
    }));
    const owner = app.jwt.sign(claims("owner-prune"));
    const crew = app.jwt.sign(claims("crew-prune"));
    const roomId = await createRoom(app, owner, "owner-prune");
    await addMember(app, roomId, owner, crew, "Ada");
    await registerPush(app, crew, "stale-phone");
    assert.equal((await listChatPushDevicesForUsers(["crew-prune"])).length, 1);
    await send(app, owner, roomId, { clientMessageId: "x", text: "hello" });
    await _settleChatPushForTests();
    assert.equal((await listChatPushDevicesForUsers(["crew-prune"])).length, 0);
  });
});

test("chat messages: oversize text, oversize photo, and wrong photo type are refused", async () => {
  await withApp(async (app) => {
    const owner = app.jwt.sign(claims("owner-limit"));
    const roomId = await createRoom(app, owner, "owner-limit");
    assert.equal((await send(app, owner, roomId, { clientMessageId: "big", text: "x".repeat(4001) })).statusCode, 413);
    assert.equal((await send(app, owner, roomId, { clientMessageId: "ok", text: "x".repeat(4000) })).statusCode, 201);
    assert.equal((await send(app, owner, roomId, { clientMessageId: "none", text: "   " })).statusCode, 400);
    const huge = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/photos`,
      payload: Buffer.alloc(10 * 1024 * 1024 + 1),
      headers: { authorization: `Bearer ${owner}`, "content-type": "image/jpeg" }
    });
    assert.equal(huge.statusCode, 413);
    const gif = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/photos`,
      payload: "GIF89a",
      headers: { authorization: `Bearer ${owner}`, "content-type": "text/plain" }
    });
    assert.equal(gif.statusCode, 415);
  });
});

test("chat messages: photos upload, attach, and load from a signed URL; others' keys are refused", async () => {
  await withApp(async (app) => {
    const owner = app.jwt.sign(claims("owner-photo"));
    const crew = app.jwt.sign(claims("crew-photo"));
    const roomId = await createRoom(app, owner, "owner-photo");
    await addMember(app, roomId, owner, crew, "Ada");
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const upload = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/photos`,
      payload: bytes,
      headers: { authorization: `Bearer ${owner}`, "content-type": "image/jpeg" }
    });
    assert.equal(upload.statusCode, 201);
    const { photoKey, byteSize } = upload.json() as ChatPhotoUploadResponse;
    assert.equal(byteSize, bytes.length);
    assert.equal((await send(app, crew, roomId, { clientMessageId: "steal", photoKey })).statusCode, 400);
    assert.equal(
      (await send(app, owner, roomId, { clientMessageId: "bogus", photoKey: photoKey.replace(/[0-9a-f]{8}-/, "00000000-") }))
        .statusCode,
      400
    );
    const sent = await send(app, owner, roomId, { clientMessageId: "pic", photoKey, text: "aid 2 table" });
    assert.equal(sent.statusCode, 201);
    const page = (await list(app, crew, roomId)).json() as ChatMessagePage;
    const photo = page.messages[0]?.photo;
    assert.ok(photo);
    assert.equal(photo.contentType, "image/jpeg");
    assert.equal(photo.byteSize, bytes.length);
    const fetched = await app.inject({ method: "GET", url: photo.url });
    assert.equal(fetched.statusCode, 200);
    assert.deepEqual(fetched.rawPayload, bytes);
    const tamperedUrl = photo.url.replace(/sig=([0-9a-f])/, (_m, c: string) => `sig=${c === "0" ? "1" : "0"}`);
    const tampered = await app.inject({ method: "GET", url: tamperedUrl });
    assert.equal(tampered.statusCode, 404);
  });
});

test("chat retention deletes a finished room's messages and photos", async () => {
  await withApp(async (app) => {
    const owner = app.jwt.sign(claims("owner-ret"));
    const roomId = await createRoom(app, owner, "owner-ret");
    const upload = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/photos`,
      payload: Buffer.from([1, 2, 3]),
      headers: { authorization: `Bearer ${owner}`, "content-type": "image/png" }
    });
    const { photoKey } = upload.json() as ChatPhotoUploadResponse;
    await send(app, owner, roomId, { clientMessageId: "a", text: "one", photoKey });
    await send(app, owner, roomId, { clientMessageId: "b", text: "two" });
    const results = await runChatRetentionPass(
      [{ id: roomId, eventEndsAt: "2026-01-01T00:00:00.000Z", status: "completed" as never }],
      new Date("2026-03-01T00:00:00.000Z")
    );
    assert.equal(results[0]?.messagesPurged, 2);
    assert.equal(results[0]?.photosPurged, 1);
    const page = (await list(app, owner, roomId)).json() as ChatMessagePage;
    assert.deepEqual(page.messages, []);
  });
});

test(
  "chat messages: the crew's conversation survives an API restart, and a retry after the restart is not stored twice",
  { skip: getRoomPersistenceMode() !== "postgres" && "needs Postgres (test:pg)", timeout: 60_000 },
  async () => {
    let roomId = "";
    let ownerToken = "";
    let crewToken = "";
    let firstId = "";
    let latestCursor = "";
    await withApp(async (app) => {
      const sub = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ownerToken = app.jwt.sign(claims(`owner-rs-${sub}`));
      crewToken = app.jwt.sign(claims(`crew-rs-${sub}`));
      roomId = await createRoom(app, ownerToken, `owner-rs-${sub}`);
      await addMember(app, roomId, ownerToken, crewToken, "Ada");
      const a = await send(app, ownerToken, roomId, { clientMessageId: "rs-1", text: "aid 3 in 20" });
      const b = await send(app, crewToken, roomId, { clientMessageId: "rs-2", text: "copy, leaving now" });
      assert.equal(a.statusCode, 201);
      assert.equal(b.statusCode, 201);
      firstId = (a.json() as ChatSendMessageResponse).message.id;
      const page = (await list(app, crewToken, roomId)).json() as ChatMessagePage;
      assert.deepEqual(page.messages.map((m) => m.text), ["aid 3 in 20", "copy, leaving now"]);
      latestCursor = page.latestCursor;
    });

    // A fresh process has no chat state in memory; everything must come back from Postgres.
    const appModule = fileURLToPath(new URL("../app.js", import.meta.url));
    const script = `
      const { buildApp } = await import(process.argv[1]);
      const [roomId, owner, crew] = process.argv.slice(2);
      const app = buildApp();
      await app.ready();
      const call = (method, token, url, payload) =>
        app.inject({ method, url, payload, headers: { authorization: "Bearer " + token } });
      const before = (await call("GET", crew, "/chat/rooms/" + roomId + "/messages")).json();
      const retry = await call("POST", owner, "/chat/rooms/" + roomId + "/messages", { clientMessageId: "rs-1", text: "aid 3 in 20" });
      const fresh = await call("POST", crew, "/chat/rooms/" + roomId + "/messages", { clientMessageId: "rs-3", text: "at aid 3" });
      const after = (await call("GET", owner, "/chat/rooms/" + roomId + "/messages")).json();
      const out = {
        beforeTexts: before.messages.map((m) => m.text),
        beforeCursor: before.latestCursor,
        retryStatus: retry.statusCode,
        retry: retry.json(),
        freshStatus: fresh.statusCode,
        afterTexts: after.messages.map((m) => m.text)
      };
      process.stdout.write("\\nRESULT:" + JSON.stringify(out) + "\\n");
      await app.close();
      process.exit(0);
    `;
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script, new URL(`file://${appModule}`).href, roomId, ownerToken, crewToken],
      { encoding: "utf8", env: process.env, timeout: 45_000 }
    );
    const result = JSON.parse(out.split("\n").find((line) => line.startsWith("RESULT:"))!.slice("RESULT:".length)) as {
      beforeTexts: string[];
      beforeCursor: string;
      retryStatus: number;
      retry: ChatSendMessageResponse;
      freshStatus: number;
      afterTexts: string[];
    };
    assert.deepEqual(result.beforeTexts, ["aid 3 in 20", "copy, leaving now"]);
    assert.equal(result.beforeCursor, latestCursor);
    assert.equal(result.retryStatus, 200);
    assert.equal(result.retry.duplicate, true);
    assert.equal(result.retry.message.id, firstId);
    assert.equal(result.freshStatus, 201);
    assert.deepEqual(result.afterTexts, ["aid 3 in 20", "copy, leaving now", "at aid 3"]);
  }
);

test("account deletion removes the messages and photos a user sent, and nobody else's", async () => {
  await withApp(async (app) => {
    const owner = app.jwt.sign(claims("owner-gone"));
    const crew = app.jwt.sign(claims("crew-gone"));
    const roomId = await createRoom(app, owner, "owner-gone");
    await addMember(app, roomId, owner, crew, "Ada");
    const upload = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/photos`,
      payload: Buffer.from([9, 9, 9]),
      headers: { authorization: `Bearer ${crew}`, "content-type": "image/jpeg" }
    });
    const { photoKey } = upload.json() as ChatPhotoUploadResponse;
    await send(app, crew, roomId, { clientMessageId: "c1", text: "mine", photoKey });
    await send(app, owner, roomId, { clientMessageId: "o1", text: "theirs" });
    const result = await deleteChatDataForUser("crew-gone");
    assert.equal(result.messagesPurged, 1);
    const page = (await list(app, owner, roomId)).json() as ChatMessagePage;
    assert.deepEqual(page.messages.map((m) => m.text), ["theirs"]);
  });
});
