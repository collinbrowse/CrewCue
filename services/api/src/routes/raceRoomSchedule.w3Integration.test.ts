/**
 * W3-I (#406) integration smoke:
 * GPX history ingest → POST /pacing-estimates → attach plan of record → GET /schedule
 * uses estimate baseline (+ delay overlay still shifts later clocks).
 *
 * Edge-case reuse (do not duplicate full matrices):
 * - EC2 invalid attach, EC3 authz, EC5 re-attach, EC6 ISO-Z, EC7 delay, EC8 check-in:
 *   `raceRoomSchedule.estimateWire.test.ts` (W3-4)
 * - Empty/corrupt GPX: `activityHistory.test.ts` (W3-1)
 * - Cold-start estimate API: `pacingEstimates.test.ts` (W3-3)
 * - EC8 DEV mobile: ios-simulator-agent-qa on `crewcue://dev/cold-start` (PR evidence)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseActivityHistoryRef,
  parseCrewScheduleSheet,
  parsePacingEstimate,
  type CrewScheduleSheet,
  type PacingEstimate,
  type RaceRoom
} from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { resetActivityHistoryStoreForTests } from "../lib/activityHistoryStore.js";
import { DEFAULT_PACING_ESTIMATE_SEED } from "../lib/pacingEstimate/index.js";
import { resetPacingEstimateStoreForTests } from "../lib/pacingEstimateStore.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";
import { projectCrewScheduleSheet } from "./raceRoomSchedule.js";

const GOLDEN_CHECKPOINT_IDS = ["start", "aid-1", "aid-2", "aid-3", "finish"] as const;
const RACE_START_AT = "2026-08-15T13:00:00.000Z";
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "activity-long-trail.gpx"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found");
}

const pacingDir = findPacingFixturesDir();

function readPacingGpx(fileName: string): string {
  return readFileSync(resolve(pacingDir, fileName), "utf8");
}

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

type TestApp = ReturnType<typeof buildApp>;

async function createPaidRoom(app: TestApp, ownerToken: string, name: string): Promise<string> {
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name,
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;
  const entitlement = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(entitlement.statusCode, 200);
  return roomId;
}

async function put50kCourse(app: TestApp, roomId: string, ownerToken: string) {
  const fixture = load50kCourseWithAids();
  const response = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: { checkpoints: fixture.checkpoints },
      routeOverlayLayer: fixture.routeOverlayLayer,
      raceStartAt: RACE_START_AT
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(response.statusCode, 200);
  return response.json() as RaceRoom;
}

async function ingestGpx(app: TestApp, token: string, fileName: string, externalId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/activity-history/gpx",
    headers: { authorization: `Bearer ${token}` },
    payload: { gpxXml: readPacingGpx(fileName), externalId }
  });
  assert.ok(response.statusCode === 201 || response.statusCode === 200, response.body);
  return parseActivityHistoryRef(response.json());
}

async function postEstimate(
  app: TestApp,
  token: string,
  room: RaceRoom,
  opts?: { historyRefIds?: string[]; seed?: string }
): Promise<PacingEstimate> {
  assert.ok(room.course?.checkpoints);
  const response = await app.inject({
    method: "POST",
    url: "/pacing-estimates",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      raceStartAt: RACE_START_AT,
      checkpoints: room.course.checkpoints,
      historyRefIds: opts?.historyRefIds,
      seed: opts?.seed ?? DEFAULT_PACING_ESTIMATE_SEED
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  return parsePacingEstimate(response.json());
}

async function attachEstimate(app: TestApp, roomId: string, token: string, estimateId: string) {
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/pacing-estimate`,
    payload: { pacingEstimateId: estimateId },
    headers: { authorization: `Bearer ${token}` }
  });
}

async function getSchedule(app: TestApp, roomId: string, token: string) {
  return app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/schedule`,
    headers: { authorization: `Bearer ${token}` }
  });
}

function stopByCheckpoint(sheet: CrewScheduleSheet, checkpointId: string) {
  const stop = sheet.stops.find((row) => row.checkpointId === checkpointId);
  assert.ok(stop, `missing schedule stop ${checkpointId}`);
  return stop;
}

function assertEstimateBaseline(sheet: CrewScheduleSheet, estimate: PacingEstimate) {
  assert.equal(sheet.pacingEstimateId, estimate.id);
  for (const stop of sheet.stops) {
    assert.match(stop.clockArrivalAt, ISO_Z);
  }

  const startDwell = stopByCheckpoint(sheet, "start").plannedDwellSeconds;
  const aid1Eta = estimate.aidEtas.find((row) => row.checkpointId === "aid-1");
  assert.ok(aid1Eta);
  assert.equal(
    stopByCheckpoint(sheet, "aid-1").elapsedSeconds,
    aid1Eta.elapsedSeconds + startDwell
  );

  const finishMoving = estimate.expectedFinishElapsedSeconds;
  let priorDwell = 0;
  for (const id of GOLDEN_CHECKPOINT_IDS) {
    if (id === "finish") break;
    const stop = stopByCheckpoint(sheet, id);
    priorDwell += stop.plannedDwellSeconds + (stop.delayOverrideSeconds ?? 0);
  }
  assert.equal(stopByCheckpoint(sheet, "finish").elapsedSeconds, finishMoving + priorDwell);
}

async function withApp(run: (ctx: { app: TestApp; tokenFor: (sub: string) => string }) => Promise<void>) {
  await resetActivityHistoryStoreForTests();
  await resetPacingEstimateStoreForTests();
  const app = buildApp();
  await app.ready();
  try {
    await run({
      app,
      tokenFor: (sub) => app.jwt.sign(buildClaims(sub))
    });
  } finally {
    await app.close();
    await resetActivityHistoryStoreForTests();
    await resetPacingEstimateStoreForTests();
  }
}

test("W3-I happy path: GPX history → estimate → attach → GET /schedule estimate baseline", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w3i-happy");
    const roomId = await createPaidRoom(app, ownerToken, "W3-I history E2E");
    const room = await put50kCourse(app, roomId, ownerToken);

    const paceBaseline = projectCrewScheduleSheet(room);
    assert.equal(paceBaseline.pacingEstimateId, undefined);

    const long = await ingestGpx(app, ownerToken, "activity-long-trail.gpx", "gpx:w3i-long-trail");
    await ingestGpx(app, ownerToken, "activity-short-road.gpx", "gpx:w3i-short-road");

    const estimate = await postEstimate(app, ownerToken, room, {
      historyRefIds: [long.id]
    });
    assert.equal(estimate.coldStart, false);
    assert.deepEqual(estimate.historyRefIds, [long.id]);

    const attach = await attachEstimate(app, roomId, ownerToken, estimate.id);
    assert.equal(attach.statusCode, 200, attach.body);

    const response = await getSchedule(app, roomId, ownerToken);
    assert.equal(response.statusCode, 200);
    const sheet = parseCrewScheduleSheet(response.json());
    assertEstimateBaseline(sheet, estimate);

    // History-backed finish must differ from pure planned-pace baseline (integration signal).
    assert.notEqual(
      stopByCheckpoint(sheet, "finish").elapsedSeconds,
      stopByCheckpoint(paceBaseline, "finish").elapsedSeconds
    );
  });
});

test("EC1: empty history coldStart estimate attaches and drives schedule", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w3i-ec1");
    const roomId = await createPaidRoom(app, ownerToken, "W3-I coldStart E2E");
    const room = await put50kCourse(app, roomId, ownerToken);

    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [] });
    assert.equal(estimate.coldStart, true);
    assert.match(estimate.expectedFinishAt, ISO_Z);

    const attach = await attachEstimate(app, roomId, ownerToken, estimate.id);
    assert.equal(attach.statusCode, 200, attach.body);

    const response = await getSchedule(app, roomId, ownerToken);
    assert.equal(response.statusCode, 200);
    const sheet = parseCrewScheduleSheet(response.json());
    assertEstimateBaseline(sheet, estimate);
    assert.equal(estimate.coldStart, true);
    assert.equal((attach.json() as { estimate?: { coldStart?: boolean } }).estimate?.coldStart, true);
  });
});

test("EC2: invalid estimate attach returns 400 (W3-I smoke)", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w3i-ec2");
    const roomId = await createPaidRoom(app, ownerToken, "W3-I invalid attach");
    await put50kCourse(app, roomId, ownerToken);

    const missing = await attachEstimate(app, roomId, ownerToken, "est_does_not_exist");
    assert.equal(missing.statusCode, 400);
    assert.equal((missing.json() as { code?: string }).code, "invalid_estimate_id");
  });
});

test("EC3: unauthorized attach returns 401 (W3-I smoke)", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w3i-ec3");
    const roomId = await createPaidRoom(app, ownerToken, "W3-I authz");
    const room = await put50kCourse(app, roomId, ownerToken);
    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [] });

    const unauth = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/pacing-estimate`,
      payload: { pacingEstimateId: estimate.id }
    });
    assert.equal(unauth.statusCode, 401);
  });
});

test("EC4 N/A offline — W3-I path is in-process HTTP only", async () => {
  assert.equal(typeof projectCrewScheduleSheet, "function");
});

test("EC5: re-attach same estimate is idempotent (W3-I smoke)", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w3i-ec5");
    const roomId = await createPaidRoom(app, ownerToken, "W3-I idempotent");
    const room = await put50kCourse(app, roomId, ownerToken);
    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [] });

    const first = await attachEstimate(app, roomId, ownerToken, estimate.id);
    const second = await attachEstimate(app, roomId, ownerToken, estimate.id);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.deepEqual(first.json(), second.json());
  });
});

test("EC6: estimate-backed schedule clocks remain ISO-Z (W3-I smoke)", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w3i-ec6");
    const roomId = await createPaidRoom(app, ownerToken, "W3-I ISO-Z");
    const room = await put50kCourse(app, roomId, ownerToken);
    const long = await ingestGpx(app, ownerToken, "activity-long-trail.gpx", "gpx:w3i-ec6");
    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [long.id] });
    assert.equal((await attachEstimate(app, roomId, ownerToken, estimate.id)).statusCode, 200);

    const sheet = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    for (const stop of sheet.stops) {
      assert.match(stop.clockArrivalAt, ISO_Z);
    }
  });
});

test("EC7: estimate + delay overlay shifts later clocks (W3-I smoke)", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w3i-ec7");
    const roomId = await createPaidRoom(app, ownerToken, "W3-I estimate+delay");
    const room = await put50kCourse(app, roomId, ownerToken);
    const long = await ingestGpx(app, ownerToken, "activity-long-trail.gpx", "gpx:w3i-ec7");
    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [long.id] });
    assert.equal((await attachEstimate(app, roomId, ownerToken, estimate.id)).statusCode, 200);

    const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    const delaySeconds = 180;
    const put = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/stop-plans/aid-1`,
      payload: { delayOverrideSeconds: delaySeconds },
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(put.statusCode, 200);

    const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assert.equal(after.pacingEstimateId, estimate.id);
    assert.equal(
      stopByCheckpoint(after, "aid-2").elapsedSeconds,
      stopByCheckpoint(baseline, "aid-2").elapsedSeconds + delaySeconds
    );
    assert.equal(
      stopByCheckpoint(after, "finish").elapsedSeconds,
      stopByCheckpoint(baseline, "finish").elapsedSeconds + delaySeconds
    );
  });
});

test("EC8 N/A in API — DEV cold-start proved on simulator (see PR)", async () => {
  // Mobile EC8: `crewcue://dev/cold-start` via ios-simulator-agent-qa; evidence on PR only.
  assert.ok(existsSync(resolve(pacingDir, "estimate-cold-start.json")));
});
