import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { StreamChat } from "stream-chat";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import { _resetChatPersistenceForTests } from "../lib/chatPersistence.js";
import { deriveStreamUserId } from "../lib/streamChat.js";

function buildClaims(sub: string, teamIds: string[] = ["team-chat"]) {
  return { sub, teamIds, roomRoles: {} };
}

async function createActivatedRoom(
  app: ReturnType<typeof buildApp>,
  athleteToken: string,
  athleteSub: string
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-chat",
      athleteId: athleteSub,
      name: "Chat Test Room",
      creatorRole: "athlete"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(created.statusCode, 201);
  const roomId = (created.json() as { id: string }).id;

  const pay = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${athleteToken}` }
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
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(activate.statusCode, 200);
  return roomId;
}

async function inviteAndAcceptMember(
  app: ReturnType<typeof buildApp>,
  roomId: string,
  ownerToken: string,
  memberToken: string,
  email = "crew@example.com"
): Promise<void> {
  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email, role: "crew_member" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(invite.statusCode, 201);
  const inviteToken = (invite.json() as { token: string }).token;
  const accept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: inviteToken },
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(accept.statusCode, 200);
}

test("chat: identity registration requires auth and persists", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const unauthorized = await app.inject({
      method: "POST",
      url: "/chat/identity",
      payload: { publicKey: "pk-1" }
    });
    assert.equal(unauthorized.statusCode, 401);

    const token = app.jwt.sign(buildClaims("user-a"));
    const ok = await app.inject({
      method: "POST",
      url: "/chat/identity",
      payload: { publicKey: "pk-1" },
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(ok.statusCode, 201);
    const body = ok.json() as { userId: string; publicKey: string };
    assert.equal(body.userId, "user-a");
    assert.equal(body.publicKey, "pk-1");

    const lookup = await app.inject({
      method: "GET",
      url: "/chat/users/user-a/identity",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(lookup.statusCode, 200);
    assert.equal((lookup.json() as { publicKey: string }).publicKey, "pk-1");
  } finally {
    await app.close();
  }
});

test("chat: identity lookup is limited to self or shared room members", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-identity"));
    const crewToken = app.jwt.sign(buildClaims("crew-identity"));
    const outsiderToken = app.jwt.sign(buildClaims("outsider-identity"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-identity");

    const crewIdentity = await app.inject({
      method: "POST",
      url: "/chat/identity",
      payload: { publicKey: "pk-crew-shared" },
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(crewIdentity.statusCode, 201);

    const outsiderDenied = await app.inject({
      method: "GET",
      url: "/chat/users/crew-identity/identity",
      headers: { authorization: `Bearer ${outsiderToken}` }
    });
    assert.equal(outsiderDenied.statusCode, 403);

    await inviteAndAcceptMember(
      app,
      roomId,
      athleteToken,
      crewToken,
      "crew-identity@example.com"
    );

    const sharedMemberLookup = await app.inject({
      method: "GET",
      url: "/chat/users/crew-identity/identity",
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(sharedMemberLookup.statusCode, 200);
    assert.equal((sharedMemberLookup.json() as { publicKey: string }).publicKey, "pk-crew-shared");
  } finally {
    await app.close();
  }
});

test("chat: identity backup round-trip (caller only)", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const token = app.jwt.sign(buildClaims("user-backup"));
    const upload = await app.inject({
      method: "POST",
      url: "/chat/identity/backup",
      payload: { ciphertext: "ct", nonce: "n", version: 1 },
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(upload.statusCode, 201);

    const fetch = await app.inject({
      method: "GET",
      url: "/chat/identity/backup",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(fetch.statusCode, 200);
    const body = fetch.json() as { ciphertext: string; version: number };
    assert.equal(body.ciphertext, "ct");
    assert.equal(body.version, 1);
  } finally {
    await app.close();
  }
});

test("chat: push device registration on /chat/devices", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const token = app.jwt.sign(buildClaims("user-push"));
    const ok = await app.inject({
      method: "POST",
      url: "/chat/devices",
      payload: { deviceId: "dev-1", platform: "ios", token: "apns-1" },
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(ok.statusCode, 201);
    const body = ok.json() as { userId: string; deviceId: string };
    assert.equal(body.userId, "user-push");
    assert.equal(body.deviceId, "dev-1");
  } finally {
    await app.close();
  }
});

test("chat: only race owner can purge room chat data", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-retention"));
    const crewToken = app.jwt.sign(buildClaims("crew-retention"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-retention");
    await inviteAndAcceptMember(app, roomId, athleteToken, crewToken, "crew-retention@example.com");

    const athletePref = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      payload: { preference: "mentions" },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(athletePref.statusCode, 200);
    const crewPref = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      payload: { preference: "none" },
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(crewPref.statusCode, 200);

    const upload = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/key-envelopes`,
      payload: {
        envelopes: [
          {
            recipientUserId: "athlete-retention",
            senderEphemeralPublicKey: "eph",
            nonce: "n1",
            ciphertext: "ct1",
            keyVersion: 3
          },
          {
            recipientUserId: "crew-retention",
            senderEphemeralPublicKey: "eph",
            nonce: "n2",
            ciphertext: "ct2",
            keyVersion: 3
          }
        ]
      },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(upload.statusCode, 201);

    const memberDenied = await app.inject({
      method: "DELETE",
      url: `/chat/rooms/${roomId}/messages`,
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(memberDenied.statusCode, 403);

    const purged = await app.inject({
      method: "DELETE",
      url: `/chat/rooms/${roomId}/messages`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(purged.statusCode, 200);
    const body = purged.json() as { envelopesPurged: number; prefsPurged: number; roomId: string };
    assert.equal(body.roomId, roomId);
    assert.equal(body.envelopesPurged, 2);
    assert.equal(body.prefsPurged, 2);

    const list = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/key-envelopes`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(list.statusCode, 200);
    assert.deepEqual((list.json() as { envelopes: unknown[] }).envelopes, []);

    const defaultPref = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(defaultPref.statusCode, 200);
    assert.equal((defaultPref.json() as { preference: string }).preference, "all");
  } finally {
    await app.close();
  }
});

test("chat: stream-token returns 503 when stream credentials missing", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const token = app.jwt.sign(buildClaims("user-x"));
    const res = await app.inject({
      method: "POST",
      url: "/chat/stream-token",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.statusCode, 503);
  } finally {
    await app.close();
  }
});

test("chat: stream-token returns signed JWT when credentials configured", async () => {
  _resetChatPersistenceForTests();
  process.env.STREAM_API_KEY = "test-key";
  process.env.STREAM_API_SECRET = "test-secret";
  const app = buildApp();
  await app.ready();
  try {
    const token = app.jwt.sign(buildClaims("user-stream"));
    const res = await app.inject({
      method: "POST",
      url: "/chat/stream-token",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { token: string; streamUserId: string; streamApiKey: string };
    assert.ok(body.token.length > 10);
    assert.equal(body.streamUserId, deriveStreamUserId("user-stream"));
    assert.equal(body.streamApiKey, "test-key");
  } finally {
    delete process.env.STREAM_API_KEY;
    delete process.env.STREAM_API_SECRET;
    await app.close();
  }
});

test("chat: room-scoped stream-token returns 502 when Stream channel sync fails", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  const streamChat = StreamChat as unknown as { getInstance: typeof StreamChat.getInstance };
  const originalGetInstance = streamChat.getInstance;
  try {
    const token = app.jwt.sign(buildClaims("user-stream-sync"));
    const roomId = await createActivatedRoom(app, token, "user-stream-sync");

    process.env.STREAM_API_KEY = "test-key";
    process.env.STREAM_API_SECRET = "test-secret";
    streamChat.getInstance = (() =>
      ({
        upsertUsers: async () => {
          throw new Error("stream unavailable");
        },
        channel: () => ({
          create: async () => {},
          query: async () => {},
          addMembers: async () => {},
          removeMembers: async () => {},
          state: { members: {} }
        })
      }) as unknown as ReturnType<typeof StreamChat.getInstance>) as typeof StreamChat.getInstance;

    const res = await app.inject({
      method: "POST",
      url: "/chat/stream-token",
      payload: { roomId },
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.statusCode, 502);
    assert.equal((res.json() as { error: string }).error, "Failed to prepare Stream Chat channel for this room");
  } finally {
    streamChat.getInstance = originalGetInstance;
    delete process.env.STREAM_API_KEY;
    delete process.env.STREAM_API_SECRET;
    await app.close();
  }
});

test("chat: key-envelope upload requires room membership", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-1"));
    const outsiderToken = app.jwt.sign(buildClaims("outsider-1"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-1");

    const denied = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/key-envelopes`,
      payload: {
        envelopes: [
          {
            recipientUserId: "athlete-1",
            senderEphemeralPublicKey: "ephK",
            nonce: "n1",
            ciphertext: "ct1",
            keyVersion: 1
          }
        ]
      },
      headers: { authorization: `Bearer ${outsiderToken}` }
    });
    assert.equal(denied.statusCode, 403);

    const ok = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/key-envelopes`,
      payload: {
        envelopes: [
          {
            recipientUserId: "athlete-1",
            senderEphemeralPublicKey: "ephK",
            nonce: "n1",
            ciphertext: "ct1",
            keyVersion: 1
          }
        ]
      },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(ok.statusCode, 201);

    const list = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/key-envelopes`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(list.statusCode, 200);
    const envelopes = (list.json() as { envelopes: Array<{ ciphertext: string }> }).envelopes;
    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0]?.ciphertext, "ct1");
  } finally {
    await app.close();
  }
});

test("chat: member remove rotates key version and clears envelopes", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-rm"));
    const crewToken = app.jwt.sign(buildClaims("crew-rm"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-rm");

    const invite = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/invites`,
      payload: { email: "crew@example.com", role: "crew_member" },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(invite.statusCode, 201);
    const inviteToken = (invite.json() as { token: string }).token;
    const accept = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/invites/accept`,
      payload: { token: inviteToken },
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(accept.statusCode, 200);

    const upload = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/key-envelopes`,
      payload: {
        envelopes: [
          {
            recipientUserId: "athlete-rm",
            senderEphemeralPublicKey: "eph",
            nonce: "n",
            ciphertext: "ct",
            keyVersion: 1
          },
          {
            recipientUserId: "crew-rm",
            senderEphemeralPublicKey: "eph",
            nonce: "n2",
            ciphertext: "ct2",
            keyVersion: 1
          }
        ]
      },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(upload.statusCode, 201);

    const remove = await app.inject({
      method: "DELETE",
      url: `/race-rooms/${roomId}/members/crew-rm`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(remove.statusCode, 200);

    const list = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/key-envelopes`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    const parsed = list.json() as { envelopes: unknown[]; latestRoomKeyVersion?: number };
    assert.equal(parsed.envelopes.length, 0);
    assert.equal(parsed.latestRoomKeyVersion, 2);
  } finally {
    await app.close();
  }
});

test("chat: notification preferences round-trip with default 'all'", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-2"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-2");

    const def = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(def.statusCode, 200);
    assert.equal((def.json() as { preference: string }).preference, "all");

    const set = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      payload: { preference: "mentions" },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(set.statusCode, 200);

    const after = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal((after.json() as { preference: string }).preference, "mentions");
  } finally {
    await app.close();
  }
});

test("chat: push webhook respects per-user preferences", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-3"));
    const userBToken = app.jwt.sign(buildClaims("user-b"));
    const userCToken = app.jwt.sign(buildClaims("user-c"));
    const userDToken = app.jwt.sign(buildClaims("user-d"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-3");

    for (const [userId, userToken] of [
      ["user-b", userBToken],
      ["user-c", userCToken],
      ["user-d", userDToken]
    ] as const) {
      const invite = await app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/invites`,
        payload: { email: `${userId}@example.com`, role: "crew_member" },
        headers: { authorization: `Bearer ${athleteToken}` }
      });
      assert.equal(invite.statusCode, 201);
      const inviteToken = (invite.json() as { token: string }).token;
      const accept = await app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/invites/accept`,
        payload: { token: inviteToken },
        headers: { authorization: `Bearer ${userToken}` }
      });
      assert.equal(accept.statusCode, 200);
    }

    for (const [userToken, pref] of [
      [userBToken, "all"],
      [userCToken, "mentions"],
      [userDToken, "none"]
    ] as const) {
      const set = await app.inject({
        method: "POST",
        url: `/chat/rooms/${roomId}/notification-prefs`,
        payload: { preference: pref },
        headers: { authorization: `Bearer ${userToken}` }
      });
      assert.equal(set.statusCode, 200);
    }

    for (const [userId, userToken] of [
      ["user-b", userBToken],
      ["user-c", userCToken],
      ["user-d", userDToken]
    ] as const) {
      const reg = await app.inject({
        method: "POST",
        url: "/chat/push/tokens",
        payload: { deviceId: `dev-${userId}`, platform: "ios", token: `apns-${userId}` },
        headers: { authorization: `Bearer ${userToken}` }
      });
      assert.equal(reg.statusCode, 201);
    }

    const noMention = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "athlete-3",
        recipientUserIds: ["athlete-3", "user-b", "user-c", "user-d"],
        roomId,
        encryptedPreview: { ciphertext: "ct", nonce: "n", keyVersion: 1 }
      }
    });
    assert.equal(noMention.statusCode, 200);
    const noMentionResult = noMention.json() as {
      delivered: number;
      tokens: Array<{ userId: string }>;
    };
    const notified = new Set(noMentionResult.tokens.map((t) => t.userId));
    assert.ok(notified.has("user-b"));
    assert.ok(!notified.has("user-c"));
    assert.ok(!notified.has("user-d"));

    const withMention = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "athlete-3",
        recipientUserIds: ["athlete-3", "user-b", "user-c", "user-d"],
        roomId,
        mentionedUserIds: ["user-c"],
        encryptedPreview: { ciphertext: "ct", nonce: "n", keyVersion: 1 }
      }
    });
    assert.equal(withMention.statusCode, 200);
    const mentionResult = withMention.json() as { tokens: Array<{ userId: string }> };
    const mentionNotified = new Set(mentionResult.tokens.map((t) => t.userId));
    assert.ok(mentionNotified.has("user-b"));
    assert.ok(mentionNotified.has("user-c"));
    assert.ok(!mentionNotified.has("user-d"));
  } finally {
    await app.close();
  }
});
