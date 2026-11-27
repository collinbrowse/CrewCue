import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import { randomUUID } from "node:crypto";
import { _resetChatPersistenceForTests, listChatPushDevicesForUsers } from "../lib/chatPersistence.js";
import { getRoomPersistenceMode } from "../lib/roomPersistence.js";
import { runInFreshProcess } from "../lib/testFreshProcess.js";
import { fakeApnsToken } from "../lib/testPushTokens.js";

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

test("chat: push device registration on /chat/devices", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const token = app.jwt.sign(buildClaims("user-push"));
    const ok = await app.inject({
      method: "POST",
      url: "/chat/devices",
      payload: { deviceId: "dev-1", platform: "ios", token: fakeApnsToken("apns-1") },
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

test("chat: push device rows are kept per user, and sign-out removes only the caller's", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const run = randomUUID();
    const ada = `ada-${run}`;
    const bo = `bo-${run}`;
    const auth = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign(buildClaims(sub))}` });
    const deviceId = `phone-${run}`;
    const register = (sub: string, token: string) =>
      app.inject({ method: "POST", url: "/chat/devices", payload: { deviceId, platform: "ios", token }, headers: auth(sub) });
    const tokensOf = async (sub: string) => (await listChatPushDevicesForUsers([sub])).map((d) => `${d.deviceId}:${d.token}`);

    const adaToken = fakeApnsToken(`ada-${run}`);
    const boToken = fakeApnsToken(`bo-${run}`);
    assert.equal((await register(ada, adaToken)).statusCode, 201);
    // The same device id under another account writes that account's own row.
    assert.equal((await register(bo, boToken)).statusCode, 201);
    assert.deepEqual(await tokensOf(ada), [`${deviceId}:${adaToken}`], "Ada's row is untouched");
    assert.deepEqual(await tokensOf(bo), [`${deviceId}:${boToken}`]);

    const remove = (sub: string, id = deviceId) =>
      app.inject({ method: "DELETE", url: `/chat/devices/${encodeURIComponent(id)}`, headers: auth(sub) });
    assert.equal((await app.inject({ method: "DELETE", url: `/chat/devices/${deviceId}` })).statusCode, 401);
    assert.equal((await remove(bo)).statusCode, 204);
    assert.deepEqual(await tokensOf(bo), []);
    assert.deepEqual(await tokensOf(ada), [`${deviceId}:${adaToken}`], "only the caller's row goes");
    assert.equal((await remove(bo)).statusCode, 404, "already removed");
    assert.equal((await remove(`nobody-${run}`)).statusCode, 404);
    assert.equal((await remove(ada)).statusCode, 204);
    assert.deepEqual(await tokensOf(ada), []);
  } finally {
    await app.close();
  }
});

test("chat: a phone registered by a new account stops getting the previous account's pushes", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const run = randomUUID();
    const ada = `ada-${run}`;
    const bo = `bo-${run}`;
    const auth = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign(buildClaims(sub))}` });
    const token = fakeApnsToken(`shared-${run}`);
    const deviceId = `phone-${run}`;
    const register = (sub: string) =>
      app.inject({ method: "POST", url: "/chat/devices", payload: { deviceId, platform: "ios", token }, headers: auth(sub) });
    assert.equal((await register(ada)).statusCode, 201);
    assert.equal((await register(bo)).statusCode, 201);
    assert.deepEqual(await listChatPushDevicesForUsers([ada]), [], "the token now belongs to Bo");
    assert.equal((await listChatPushDevicesForUsers([bo])).length, 1);
  } finally {
    await app.close();
  }
});

test("chat: push tokens are validated per platform", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const run = randomUUID();
    const headers = { authorization: `Bearer ${app.jwt.sign(buildClaims(`user-${run}`))}` };
    const register = (platform: string, token: string) =>
      app.inject({ method: "POST", url: "/chat/devices", payload: { deviceId: `d-${run}`, platform, token }, headers });
    // As the apps send them: APNs hex (32 bytes) and an FCM registration token.
    assert.equal((await register("ios", "a1".repeat(32))).statusCode, 201);
    assert.equal((await register("ios", "A1".repeat(100))).statusCode, 201, "longer APNs tokens still pass");
    assert.equal((await register("android", `fGx1-_Ab:APA91b${"Zz09_-".repeat(25)}`)).statusCode, 201);
    for (const [platform, token] of [
      ["ios", "not-hex"],
      ["ios", "abc"],
      ["ios", "a1".repeat(32) + "/x"],
      ["android", "abc/def"],
      ["android", "abc?x=1"],
      ["android", "abc def"],
      ["web", "abc%2Fdef"]
    ] as const) {
      const res = await register(platform, token);
      assert.equal(res.statusCode, 400, `${platform} ${token}`);
    }
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
    const body = purged.json() as { prefsPurged: number; roomId: string };
    assert.equal(body.roomId, roomId);
    assert.equal(body.prefsPurged, 2);

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

test("chat: diagnostics reports memberCount and photo storage only", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-diag"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-diag");
    const res = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/diagnostics`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as Record<string, unknown>;
    assert.equal(body.memberCount, 1);
    assert.equal(body.photoStorage, "memory");
    assert.equal("identityCount" in body, false);
  } finally {
    await app.close();
  }
});

test(
  "chat: a crew member's notification preference survives an API restart without leaking to others",
  { skip: getRoomPersistenceMode() !== "postgres" && "needs Postgres (test:pg)", timeout: 60_000 },
  async () => {
    const app = buildApp();
    await app.ready();
    const athleteToken = app.jwt.sign(buildClaims("athlete-restart"));
    const crewToken = app.jwt.sign(buildClaims("crew-restart"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-restart");
    await inviteAndAcceptMember(app, roomId, athleteToken, crewToken, "crew-restart@example.com");
    const set = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      payload: { preference: "mentions" },
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(set.statusCode, 200);
    await app.close();

    // A fresh process has no prefs in memory; they must come back from Postgres.
    const script = `
      const { buildApp } = await import(process.argv[1]);
      const [roomId, crew, athlete] = process.argv.slice(2);
      const app = buildApp();
      await app.ready();
      const get = async (token) => {
        const res = await app.inject({
          method: "GET",
          url: "/chat/rooms/" + roomId + "/notification-prefs",
          headers: { authorization: "Bearer " + token }
        });
        return { status: res.statusCode, preference: res.json().preference };
      };
      const out = { crew: await get(crew), athlete: await get(athlete) };
      process.stdout.write("\\nRESULT:" + JSON.stringify(out) + "\\n");
      await app.close();
      process.exit(0);
    `;
    const result = runInFreshProcess(script, [roomId, crewToken, athleteToken]) as {
      crew: { status: number; preference: string };
      athlete: { status: number; preference: string };
    };
    assert.deepEqual(result.crew, { status: 200, preference: "mentions" });
    assert.deepEqual(result.athlete, { status: 200, preference: "all" });
  }
);
