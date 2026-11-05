import test from "node:test";
import assert from "node:assert/strict";
import type { AthletePingBatchResponse, RaceRoomPingTrackResponse } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getRoomPersistenceMode } from "../lib/roomPersistence.js";
import { backlogFloorMs, setRaceRoomStatusForTests } from "./raceRooms.js";

const HOUR_MS = 60 * 60 * 1000;

function buildClaims(sub: string) {
  return { sub, teamIds: ["team-1"], roomRoles: {} };
}

async function createPaidActiveRoom(app: ReturnType<typeof buildApp>, ownerToken: string): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: "owner-user", name: "Batch Room", creatorRole: "athlete" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(create.statusCode, 201);
  const roomId = (create.json() as { id: string }).id;
  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(paid.statusCode, 200);
  const course = await app.inject({
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
      // Started long ago, so only the 48 h backlog limit applies in these route tests.
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(course.statusCode, 200);
  return roomId;
}

async function addCrewMember(app: ReturnType<typeof buildApp>, roomId: string, athleteToken: string, crewToken: string) {
  const issue = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew@example.com", role: "crew_member" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(issue.statusCode, 201);
  const accept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: (issue.json() as { token: string }).token },
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(accept.statusCode, 200);
}

/** `count` samples every 3 minutes ending `endAgoMs` before now, walking north along the course. */
function backlog(count: number, endAgoMs: number) {
  const end = Date.now() - endAgoMs;
  return Array.from({ length: count }, (_, i) => ({
    latitude: 42.0 + i * 0.0002,
    longitude: -70.0,
    recordedAt: new Date(end - (count - 1 - i) * 3 * 60 * 1000).toISOString(),
    horizontalAccuracyMeters: 10
  }));
}

async function postBatch(app: ReturnType<typeof buildApp>, roomId: string, token: string, payload: object) {
  return app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings/batch`,
    payload,
    headers: { authorization: `Bearer ${token}` }
  });
}

async function readTrack(app: ReturnType<typeof buildApp>, roomId: string, token: string, query = "") {
  const response = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/pings/track${query}`,
    headers: { authorization: `Bearer ${token}` }
  });
  return response;
}

test("backlogFloorMs: never more than 48 h back, and an hour before a race that already started", () => {
  const now = Date.parse("2026-11-04T12:00:00.000Z");
  assert.equal(backlogFloorMs(now, undefined), now - 48 * HOUR_MS);
  assert.equal(backlogFloorMs(now, now - 30 * 24 * HOUR_MS), now - 48 * HOUR_MS);
  assert.equal(backlogFloorMs(now, now - 2 * HOUR_MS), now - 3 * HOUR_MS);
});

test("accepts a 2-hour-old backlog in one request and stores the path", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, token);

  const points = backlog(40, 2 * HOUR_MS);
  const response = await postBatch(app, roomId, token, { points, uploadIntervalSeconds: 180 });
  assert.equal(response.statusCode, 200);
  const body = response.json() as AthletePingBatchResponse;
  assert.equal(body.acceptedCount, 40);
  assert.ok(body.results.every((r) => r.decision === "accepted" && r.pingId));
  assert.ok(body.projection, "projection recomputed once for the whole batch");

  const latest = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/pings/latest`,
    headers: { authorization: `Bearer ${token}` }
  });
  const latestBody = latest.json() as { ping?: { recordedAt: string }; stalenessThresholdSeconds: number };
  assert.equal(latestBody.ping?.recordedAt, points[points.length - 1]!.recordedAt);
  assert.equal(latestBody.stalenessThresholdSeconds, 540);

  const track = (await readTrack(app, roomId, token)).json() as RaceRoomPingTrackResponse;
  assert.deepEqual(
    track.points.map((p) => p.recordedAt),
    points.map((p) => p.recordedAt)
  );
  assert.equal(track.nextCursor, undefined);
  await app.close();
});

test("judges points oldest first and reports results in request order", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, token);

  const [a, b, c] = backlog(3, 10 * 60 * 1000);
  const future = { latitude: 42.001, longitude: -70.0, recordedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
  const ancient = { latitude: 42.0, longitude: -70.0, recordedAt: new Date(Date.now() - 72 * HOUR_MS).toISOString() };
  const fuzzy = { ...b!, recordedAt: new Date(Date.parse(b!.recordedAt) + 1000).toISOString(), horizontalAccuracyMeters: 900 };
  const response = await postBatch(app, roomId, token, { points: [c, future, a, ancient, fuzzy, b] });
  assert.equal(response.statusCode, 200);
  const body = response.json() as AthletePingBatchResponse;
  assert.deepEqual(
    body.results.map((r) => [r.decision, r.reason ?? null]),
    [
      ["accepted", null],
      ["rejected", "clock_skew"],
      ["accepted", null],
      ["rejected", "clock_skew"],
      ["rejected", "accuracy_too_poor"],
      ["accepted", null]
    ]
  );
  assert.equal(body.acceptedCount, 3);
  await app.close();
});

test("a replayed batch is all duplicates and stores nothing twice", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, token);
  const points = backlog(5, 30 * 60 * 1000);

  assert.equal((await postBatch(app, roomId, token, { points })).statusCode, 200);
  const replay = (await postBatch(app, roomId, token, { points })).json() as AthletePingBatchResponse;
  assert.equal(replay.acceptedCount, 0);
  assert.ok(replay.results.every((r) => r.decision === "duplicate"));

  // A sample older than the last one that the server never stored is stale, not a duplicate.
  const gap = { ...points[1]!, recordedAt: new Date(Date.parse(points[1]!.recordedAt) + 30_000).toISOString() };
  const stale = (await postBatch(app, roomId, token, { points: [gap] })).json() as AthletePingBatchResponse;
  assert.equal(stale.results[0]!.decision, "rejected");
  assert.equal(stale.results[0]!.reason, "stale_recorded_at");

  const track = (await readTrack(app, roomId, token)).json() as RaceRoomPingTrackResponse;
  assert.equal(track.points.length, 5);
  await app.close();
});

test("the speed check runs against the previous point within the batch", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, token);
  const [a, b, c] = backlog(3, 10 * 60 * 1000);
  const teleport = { ...b!, latitude: 43.0 }; // ~110 km in 3 minutes
  const body = (await postBatch(app, roomId, token, { points: [a, teleport, c] })).json() as AthletePingBatchResponse;
  assert.deepEqual(
    body.results.map((r) => r.reason ?? r.decision),
    ["accepted", "implausible_motion", "accepted"]
  );
  await app.close();
});

test("crew may read the track but not upload a batch", async () => {
  const app = buildApp();
  await app.ready();
  const athleteToken = app.jwt.sign(buildClaims("owner-user"));
  const crewToken = app.jwt.sign(buildClaims("crew-user"));
  const strangerToken = app.jwt.sign(buildClaims("stranger-user"));
  const roomId = await createPaidActiveRoom(app, athleteToken);
  await addCrewMember(app, roomId, athleteToken, crewToken);

  const forged = await postBatch(app, roomId, crewToken, { points: backlog(2, 60_000) });
  assert.equal(forged.statusCode, 403);
  assert.equal((await postBatch(app, roomId, athleteToken, { points: backlog(2, 60_000) })).statusCode, 200);

  const crewRead = await readTrack(app, roomId, crewToken);
  assert.equal(crewRead.statusCode, 200);
  assert.equal((crewRead.json() as RaceRoomPingTrackResponse).points.length, 2);
  assert.equal((await readTrack(app, roomId, strangerToken)).statusCode, 403);
  await app.close();
});

test("rejects an empty, oversized, or inactive-room batch", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, token);
  assert.equal((await postBatch(app, roomId, token, { points: [] })).statusCode, 400);
  assert.equal((await postBatch(app, roomId, token, { points: backlog(501, 0) })).statusCode, 400);

  await setRaceRoomStatusForTests(roomId, "completed");
  const inactive = await postBatch(app, roomId, token, { points: backlog(1, 0) });
  assert.equal(inactive.statusCode, 422);
  assert.equal((inactive.json() as { reason: string }).reason, "room_not_active");
  await app.close();
});

test("the track pages with after and nextCursor, and includes single pings", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, token);
  const points = backlog(5, 5 * 60 * 1000);
  await postBatch(app, roomId, token, { points });
  const single = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: { latitude: 42.0012, longitude: -70.0, recordedAt: new Date().toISOString() },
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(single.statusCode, 201);

  const page1 = (await readTrack(app, roomId, token, "?limit=4")).json() as RaceRoomPingTrackResponse;
  assert.equal(page1.points.length, 4);
  assert.equal(page1.nextCursor, points[3]!.recordedAt);
  const page2 = (
    await readTrack(app, roomId, token, `?limit=4&after=${encodeURIComponent(page1.nextCursor!)}`)
  ).json() as RaceRoomPingTrackResponse;
  assert.equal(page2.points.length, 2);
  assert.equal(page2.points[0]!.recordedAt, points[4]!.recordedAt);
  assert.equal(page2.nextCursor, undefined);

  assert.equal((await readTrack(app, roomId, token, "?limit=0")).statusCode, 400);
  assert.equal((await readTrack(app, roomId, token, "?after=yesterday")).statusCode, 400);
  await app.close();
});

test(
  "the runner's uploaded path survives an API restart, and replaying the same upload still stores nothing twice",
  { skip: getRoomPersistenceMode() !== "postgres" && "needs Postgres (test:pg)", timeout: 60_000 },
  async () => {
    const app = buildApp();
    await app.ready();
    const athlete = app.jwt.sign(buildClaims("owner-user"));
    const crew = app.jwt.sign(buildClaims("crew-user"));
    const roomId = await createPaidActiveRoom(app, athlete);
    await addCrewMember(app, roomId, athlete, crew);
    const points = backlog(12, 40 * 60 * 1000);
    const first = await postBatch(app, roomId, athlete, { points });
    assert.equal(first.statusCode, 200);
    assert.equal((first.json() as AthletePingBatchResponse).acceptedCount, 12);
    await app.close();

    // A fresh process has no memory of this room or its path; both must come back from Postgres.
    const appModule = fileURLToPath(new URL("../app.js", import.meta.url));
    const script = `
      const { buildApp } = await import(process.argv[1]);
      const [roomId, athlete, crew, pointsJson] = process.argv.slice(2);
      const app = buildApp();
      await app.ready();
      const headers = (t) => ({ authorization: "Bearer " + t });
      const track = async () =>
        (await app.inject({ method: "GET", url: "/race-rooms/" + roomId + "/pings/track", headers: headers(crew) })).json();
      const before = await track();
      const replay = await app.inject({
        method: "POST",
        url: "/race-rooms/" + roomId + "/pings/batch",
        payload: { points: JSON.parse(pointsJson) },
        headers: headers(athlete)
      });
      const after = await track();
      process.stdout.write("\\nRESULT:" + JSON.stringify({ before, replay: replay.json(), after }) + "\\n");
      await app.close();
      process.exit(0);
    `;
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script, new URL(`file://${appModule}`).href, roomId, athlete, crew, JSON.stringify(points)],
      { encoding: "utf8", env: process.env, timeout: 45_000 }
    );
    const result = JSON.parse(out.split("\n").find((line) => line.startsWith("RESULT:"))!.slice("RESULT:".length)) as {
      before: RaceRoomPingTrackResponse;
      replay: AthletePingBatchResponse;
      after: RaceRoomPingTrackResponse;
    };
    const times = points.map((p) => p.recordedAt);
    assert.deepEqual(result.before.points.map((p) => p.recordedAt), times, "crew still see the whole path, oldest first");
    assert.equal(result.replay.acceptedCount, 0);
    assert.ok(result.replay.results.every((r) => r.decision === "duplicate"), "a retry after the restart is recognised");
    assert.deepEqual(result.after.points.map((p) => p.recordedAt), times, "the retry stored nothing twice");
  }
);
