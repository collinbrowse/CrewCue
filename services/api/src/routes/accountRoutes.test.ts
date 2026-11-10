import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { parsePacingEstimate, type AccountDataExport, type AccountDeletionResult } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { deleteAccountData, setAccountDeletionDepsForTests } from "../lib/accountDeletion.js";
import { listActivityHistoryForAthlete, upsertActivityHistory } from "../lib/activityHistoryStore.js";
import { getPacingEstimateById, savePacingEstimate } from "../lib/pacingEstimateStore.js";
import { getStravaConnection, upsertStravaConnection } from "../lib/stravaConnectionStore.js";
import { appendTrackPoints, listTrackPoints } from "../lib/athletePingTrack.js";
import { listFinishedEfforts, recordFinishedEffort } from "../lib/finishedEffortStore.js";
import { listChatPushDevicesForUsers } from "../lib/chatPersistence.js";
import { setStravaClientConfigForTests } from "./stravaRoutes.js";

type Room = { id: string; joinCode: string; memberships: Array<{ userId: string }> };

const ZERO_RESULT: Omit<AccountDeletionResult, "identityProvider"> = {
  deleted: true,
  roomsClosed: 0,
  membershipsRemoved: 0,
  activityHistoryDeleted: 0,
  pacingEstimatesDeleted: 0,
  finishedEffortsDeleted: 0,
  pushDevicesDeleted: 0,
  chatPrefsDeleted: 0,
  stravaDisconnected: false
};

/** Unique per test so Postgres runs (shared DB, no truncation) stay independent. */
function uid(label: string): string {
  return `${label}-${randomUUID()}`;
}

async function withApp(fn: (ctx: { app: FastifyInstance; auth: (sub: string) => { authorization: string } }) => Promise<void>) {
  setAccountDeletionDepsForTests({ auth0Config: null, streamCleanup: null });
  const app = buildApp();
  await app.ready();
  const auth = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} })}` });
  try {
    await fn({ app, auth });
  } finally {
    setAccountDeletionDepsForTests(undefined);
    setStravaClientConfigForTests(undefined);
    await app.close();
  }
}

async function createRoom(app: FastifyInstance, headers: { authorization: string }, athleteId: string): Promise<Room> {
  const res = await app.inject({
    method: "POST",
    url: "/race-rooms",
    headers,
    payload: { teamId: "team-1", athleteId, name: "Deletion Test 100", creatorRole: "athlete" }
  });
  assert.equal(res.statusCode, 201, res.body);
  const room = res.json() as Room;
  // Rooms here hold several crew, which needs the Full Crew tier (#649).
  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/entitlement`,
    headers,
    payload: { status: "paid", crewTier: "unlimited" }
  });
  assert.equal(paid.statusCode, 200, paid.body);
  return room;
}

async function joinRoom(app: FastifyInstance, headers: { authorization: string }, room: Room): Promise<void> {
  const res = await app.inject({ method: "POST", url: "/race-rooms/join-by-code", headers, payload: { roomCode: room.joinCode } });
  assert.equal(res.statusCode, 200, res.body);
}

async function seedPersonalData(app: FastifyInstance, headers: { authorization: string }, sub: string): Promise<string> {
  const now = new Date().toISOString();
  await upsertActivityHistory(sub, {
    id: uid("ah"),
    source: "gpx_upload",
    externalId: uid("ext"),
    recordedAt: now,
    ingestedAt: now,
    distanceMeters: 50_000
  });
  const estimateId = uid("est");
  await savePacingEstimate(
    sub,
    parsePacingEstimate({
      id: estimateId,
      coldStart: true,
      expectedFinishAt: "2026-08-15T20:00:00.000Z",
      expectedFinishElapsedSeconds: 25_200,
      aidEtas: [],
      explanation: "Deletion test estimate."
    })
  );
  await upsertStravaConnection(sub, { accessToken: "a", refreshToken: "r", expiresAt: 2_000_000_000, athleteId: "42" });
  const device = await app.inject({
    method: "POST",
    url: "/chat/devices",
    headers,
    payload: { deviceId: uid("device"), platform: "ios", token: uid("apns-token") }
  });
  assert.equal(device.statusCode, 201, device.body);
  return estimateId;
}

test("DELETE /me and GET /me/export require sign-in (EC3)", async () => {
  await withApp(async ({ app }) => {
    assert.equal((await app.inject({ method: "DELETE", url: "/me" })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/me/export" })).statusCode, 401);
  });
});

test("empty account deletes cleanly with zero counts (EC1)", async () => {
  await withApp(async ({ app, auth }) => {
    const res = await app.inject({ method: "DELETE", url: "/me", headers: auth(uid("empty")) });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { ...ZERO_RESULT, identityProvider: "not_applicable" });
  });
});

test("runner deletion closes owned room for crew, leaves other rooms and users intact, replays as zeros (EC5, EC7, EC8)", async () => {
  await withApp(async ({ app, auth }) => {
    const runner = uid("runner");
    const crew = uid("crew");
    const otherRunner = uid("other-runner");

    const owned = await createRoom(app, auth(runner), runner);
    await joinRoom(app, auth(crew), owned);
    const othersRoom = await createRoom(app, auth(otherRunner), otherRunner);
    await joinRoom(app, auth(runner), othersRoom);
    await joinRoom(app, auth(crew), othersRoom);

    const estimateId = await seedPersonalData(app, auth(runner), runner);
    await seedPersonalData(app, auth(crew), crew);
    await appendTrackPoints(owned.id, [
      { recordedAtMs: Date.parse("2026-08-15T14:00:00Z"), latitude: 39.1, longitude: -106.3, receivedAtMs: Date.now(), pingId: uid("ping") }
    ]);
    await appendTrackPoints(othersRoom.id, [
      { recordedAtMs: Date.parse("2026-08-15T14:00:00Z"), latitude: 39.2, longitude: -106.4, receivedAtMs: Date.now(), pingId: uid("ping") }
    ]);
    await recordFinishedEffort({
      roomId: owned.id,
      athleteUserId: runner,
      finishedAt: "2026-08-16T04:00:00.000Z",
      courseLengthMeters: 160_000,
      actualFinishSeconds: 100_000,
      stops: []
    });

    const exported = await app.inject({ method: "GET", url: "/me/export", headers: auth(runner) });
    assert.equal(exported.statusCode, 200, exported.body);
    const exportBody = exported.json() as AccountDataExport;
    assert.equal(exportBody.userId, runner);
    assert.deepEqual(exportBody.rooms.map((r) => [r.id, r.ownedAsRunner]).sort(), [[owned.id, true], [othersRoom.id, false]].sort());
    assert.equal(exportBody.activityHistory.length, 1);
    assert.equal(exportBody.pacingEstimates[0]?.id, estimateId);
    assert.deepEqual(exportBody.strava, { connected: true });

    const res = await app.inject({ method: "DELETE", url: "/me", headers: auth(runner) });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), {
      deleted: true,
      roomsClosed: 1,
      membershipsRemoved: 1,
      activityHistoryDeleted: 1,
      pacingEstimatesDeleted: 1,
      finishedEffortsDeleted: 0, // the owned room's effort went with the room
      pushDevicesDeleted: 1,
      chatPrefsDeleted: 0,
      stravaDisconnected: true,
      identityProvider: "not_applicable"
    });

    // EC7: the runner's room is gone for the crew.
    assert.equal((await app.inject({ method: "GET", url: `/race-rooms/${owned.id}`, headers: auth(crew) })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: `/race-rooms/${owned.joinCode}`, headers: auth(crew) })).statusCode, 404);
    const crewRooms = ((await app.inject({ method: "GET", url: "/race-rooms/mine", headers: auth(crew) })).json() as { rooms: Room[] }).rooms;
    assert.deepEqual(crewRooms.map((r) => r.id), [othersRoom.id]);
    assert.deepEqual(await listTrackPoints(owned.id, undefined, 1000), []);
    assert.deepEqual(await listFinishedEfforts({ athleteUserId: runner }), []);

    // EC8: the other runner's room keeps working, minus the deleted member.
    const survivorList = await app.inject({ method: "GET", url: "/race-rooms/mine", headers: auth(otherRunner) });
    const survivor = (survivorList.json() as { rooms: Room[] }).rooms.find((r) => r.id === othersRoom.id);
    assert.ok(survivor, "other runner's room survives");
    const survivorMembers = survivor.memberships.map((m) => m.userId);
    assert.equal(survivorMembers.includes(runner), false);
    assert.equal(survivorMembers.includes(crew), true);
    assert.equal((await listTrackPoints(othersRoom.id, undefined, 1000)).length, 1);

    // Runner's personal data is gone.
    assert.deepEqual(await listActivityHistoryForAthlete(runner), []);
    assert.equal(await getPacingEstimateById(estimateId), undefined);
    assert.equal(await getStravaConnection(runner), undefined);
    assert.deepEqual(await listChatPushDevicesForUsers([runner]), []);

    // EC3: nobody else's data was touched.
    assert.equal((await listActivityHistoryForAthlete(crew)).length, 1);
    assert.notEqual(await getStravaConnection(crew), undefined);
    assert.equal((await listChatPushDevicesForUsers([crew])).length, 1);

    // EC5: replay is a no-op.
    const replay = await app.inject({ method: "DELETE", url: "/me", headers: auth(runner) });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), { ...ZERO_RESULT, identityProvider: "not_applicable" });
  });
});

test("Strava deauthorize failure still deletes the tokens (EC9)", async () => {
  await withApp(async ({ app, auth }) => {
    const sub = uid("strava");
    await upsertStravaConnection(sub, { accessToken: "a", refreshToken: "r", expiresAt: 2_000_000_000, athleteId: "7" });
    let revokeCalls = 0;
    setStravaClientConfigForTests({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://example.test/cb",
      fetchImpl: async () => {
        revokeCalls += 1;
        return new Response("down", { status: 503 });
      }
    });
    const res = await app.inject({ method: "DELETE", url: "/me", headers: auth(sub) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((res.json() as AccountDeletionResult).stravaDisconnected, true);
    assert.equal(revokeCalls, 1);
    assert.equal(await getStravaConnection(sub), undefined);
  });
});

test("Auth0 user deletion: failure is 502 and retryable, retry deletes, 404 counts as done (EC2)", async () => {
  await withApp(async ({ app, auth }) => {
    const sub = `auth0|${randomUUID()}`;
    const calls: string[] = [];
    let deleteStatus = 500;
    setAccountDeletionDepsForTests({
      streamCleanup: null,
      auth0Config: { domain: "tenant.example.auth0.com", clientId: "cid", clientSecret: "secret" },
      auth0Fetch: async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/oauth/token")) return Response.json({ access_token: "mgmt-token" });
        return new Response(null, { status: deleteStatus });
      }
    });

    const failed = await app.inject({ method: "DELETE", url: "/me", headers: auth(sub) });
    assert.equal(failed.statusCode, 502);
    assert.equal((failed.json() as { code: string; retryable: boolean }).retryable, true);
    assert.equal(calls.at(-1), `DELETE https://tenant.example.auth0.com/api/v2/users/${encodeURIComponent(sub)}`);

    deleteStatus = 204;
    const retried = await app.inject({ method: "DELETE", url: "/me", headers: auth(sub) });
    assert.equal(retried.statusCode, 200);
    assert.equal((retried.json() as AccountDeletionResult).identityProvider, "deleted");

    deleteStatus = 404;
    const again = await app.inject({ method: "DELETE", url: "/me", headers: auth(sub) });
    assert.equal((again.json() as AccountDeletionResult).identityProvider, "already_deleted");

    setAccountDeletionDepsForTests({ auth0Config: null, streamCleanup: null });
    const unconfigured = await app.inject({ method: "DELETE", url: "/me", headers: auth(sub) });
    assert.equal((unconfigured.json() as AccountDeletionResult).identityProvider, "not_configured");
  });
});

test("Stream cleanup gets the derived Stream id and owned rooms; its failure does not block deletion", async () => {
  await withApp(async ({ app, auth }) => {
    const runner = uid("stream-runner");
    const owned = await createRoom(app, auth(runner), runner);
    const seen: Array<{ streamUserId: string; ownedRoomIds: string[] }> = [];
    setAccountDeletionDepsForTests({
      auth0Config: null,
      streamCleanup: async (input) => {
        seen.push(input);
        throw new Error("stream down");
      }
    });
    const res = await app.inject({ method: "DELETE", url: "/me", headers: auth(runner) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(seen.length, 1);
    assert.match(seen[0]!.streamUserId, /^u-[0-9a-f]{32}$/);
    assert.deepEqual(seen[0]!.ownedRoomIds, [owned.id]);
  });
});

test("deletion log lines carry a hashed subject, never the raw subject or email", async () => {
  const sub = `auth0|${randomUUID()}`;
  const email = "runner@example.com";
  const lines: unknown[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args);
  };
  const log = { info: capture, warn: capture, error: capture, debug: capture } as unknown as FastifyBaseLogger;
  await deleteAccountData({ sub, email }, log, { auth0Config: null, streamCleanup: null });
  const serialized = JSON.stringify(lines);
  assert.ok(serialized.includes("account_deleted"));
  assert.equal(serialized.includes(sub), false);
  assert.equal(serialized.includes(email), false);
});
