/**
 * W4-I (#416) integration smoke:
 * cutoff warnings + estimate A-B bands + schedule expected baseline (offline crew-sheet on sim).
 *
 * Edge-case reuse (do not duplicate full matrices):
 * - Cutoff unit/API: `cutoffWarning.test.ts`, `raceRoomSchedule.cutoff.test.ts` (W4-1)
 * - Bands unit/API: `pacingEstimateBands.test.ts` (W4-2)
 * - Crew-sheet plaintext: `apps/mobile/.../crewSheetExport.test.ts` (W4-3)
 * - EC7 DEV share export: ios-simulator-agent-qa on `crewcue://dev/crew-sheet-export` (PR evidence)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUTOFF_WARN_MARGIN_SECONDS,
  parseActivityHistoryRef,
  parseCrewScheduleSheet,
  parsePacingEstimate,
  type CrewScheduleSheet,
  type PacingEstimate,
  type RaceCourseCheckpoint,
  type RaceRoom
} from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { resetActivityHistoryStoreForTests } from "../lib/activityHistoryStore.js";
import { DEFAULT_PACING_ESTIMATE_SEED } from "../lib/pacingEstimate/index.js";
import { resetPacingEstimateStoreForTests } from "../lib/pacingEstimateStore.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";
import { getRaceRoom, saveRaceRoom } from "./raceRooms.js";
import { projectCrewScheduleSheet } from "./raceRoomSchedule.js";

const GOLDEN_CHECKPOINT_IDS = ["start", "aid-1", "aid-2", "aid-3", "finish"] as const;
const RACE_START_AT = "2026-08-15T13:00:00.000Z";
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (
      existsSync(resolve(candidate, "cutoff-compare.json")) &&
      existsSync(resolve(candidate, "estimate-bands.json"))
    ) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing (cutoff-compare + estimate-bands) not found");
}

const pacingDir = findPacingFixturesDir();

function readPacingGpx(fileName: string): string {
  return readFileSync(resolve(pacingDir, fileName), "utf8");
}

function loadEstimateBandsFixture() {
  return JSON.parse(readFileSync(resolve(pacingDir, "estimate-bands.json"), "utf8")) as {
    policy: { raceStartAt: string; seed: string };
    historyBacked: { bands: NonNullable<PacingEstimate["bands"]> };
    coldStart: { bands: NonNullable<PacingEstimate["bands"]>; coldStart: boolean };
  };
}

function loadCutoffCompareFixture() {
  return JSON.parse(readFileSync(resolve(pacingDir, "cutoff-compare.json"), "utf8")) as {
    raceStartAt: string;
    warnMarginSeconds: number;
  };
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

async function put50kCourse(
  app: TestApp,
  roomId: string,
  ownerToken: string,
  checkpointMutator?: (checkpoints: RaceCourseCheckpoint[]) => RaceCourseCheckpoint[]
) {
  const fixture = load50kCourseWithAids();
  const checkpoints = checkpointMutator
    ? checkpointMutator(fixture.checkpoints.map((cp) => ({ ...cp })))
    : fixture.checkpoints;
  const response = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: { checkpoints },
      routeOverlayLayer: fixture.routeOverlayLayer,
      raceStartAt: RACE_START_AT
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as RaceRoom;
}

function applyCutoffById(
  checkpoints: RaceCourseCheckpoint[],
  byId: Record<string, RaceCourseCheckpoint["cutoff"]>
): RaceCourseCheckpoint[] {
  return checkpoints.map((cp) => {
    const cutoff = byId[cp.id];
    if (cutoff === undefined) {
      const next = { ...cp };
      delete next.cutoff;
      return next;
    }
    return { ...cp, cutoff };
  });
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

async function getSchedule(app: TestApp, roomId: string, token?: string) {
  return app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/schedule`,
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });
}

function stopByCheckpoint(sheet: CrewScheduleSheet, checkpointId: string) {
  const stop = sheet.stops.find((row) => row.checkpointId === checkpointId);
  assert.ok(stop, `missing schedule stop ${checkpointId}`);
  return stop;
}

function assertThreeBands(estimate: PacingEstimate) {
  assert.ok(estimate.bands, "bands required");
  assert.ok(estimate.bands.conservative, "conservative band");
  assert.ok(estimate.bands.expected, "expected band");
  assert.ok(estimate.bands.aggressive, "aggressive band");
  assert.equal(estimate.bands.expected.finishElapsedSeconds, estimate.expectedFinishElapsedSeconds);
  assert.equal(estimate.bands.expected.finishAt, estimate.expectedFinishAt);
  const c = estimate.bands.conservative.finishElapsedSeconds;
  const e = estimate.bands.expected.finishElapsedSeconds;
  const a = estimate.bands.aggressive.finishElapsedSeconds;
  assert.ok(c >= e && e >= a, JSON.stringify(estimate.bands));
}

function assertEstimateBaseline(sheet: CrewScheduleSheet, estimate: PacingEstimate) {
  assert.equal(sheet.pacingEstimateId, estimate.id);
  for (const stop of sheet.stops) {
    assert.match(stop.clockArrivalAt, ISO_Z);
  }

  const startStoppage = stopByCheckpoint(sheet, "start").plannedStoppageSeconds;
  const aid1Eta = estimate.aidEtas.find((row) => row.checkpointId === "aid-1");
  assert.ok(aid1Eta);
  assert.equal(
    stopByCheckpoint(sheet, "aid-1").elapsedSeconds,
    aid1Eta.elapsedSeconds + startStoppage
  );

  const finishMoving = estimate.expectedFinishElapsedSeconds;
  let priorStoppage = 0;
  for (const id of GOLDEN_CHECKPOINT_IDS) {
    if (id === "finish") break;
    const stop = stopByCheckpoint(sheet, id);
    priorStoppage += stop.plannedStoppageSeconds + (stop.delayOverrideSeconds ?? 0);
  }
  assert.equal(stopByCheckpoint(sheet, "finish").elapsedSeconds, finishMoving + priorStoppage);
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

test("W4-I fixtures: cutoff-compare + estimate-bands present and aligned", () => {
  const cutoff = loadCutoffCompareFixture();
  const bands = loadEstimateBandsFixture();
  assert.equal(cutoff.raceStartAt, RACE_START_AT);
  assert.equal(cutoff.warnMarginSeconds, CUTOFF_WARN_MARGIN_SECONDS);
  assert.equal(bands.policy.raceStartAt, RACE_START_AT);
  assert.equal(bands.policy.seed, DEFAULT_PACING_ESTIMATE_SEED);
});

test("EC1: estimate + bands + schedule — bands present; expected baseline", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w4i-ec1");
    const roomId = await createPaidRoom(app, ownerToken, "W4-I EC1 bands+schedule");
    const room = await put50kCourse(app, roomId, ownerToken);

    const long = await ingestGpx(app, ownerToken, "activity-long-trail.gpx", "gpx:w4i-ec1");
    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [long.id] });
    assert.equal(estimate.coldStart, false);
    assertThreeBands(estimate);
    // Golden band values live in estimate-bands.json (W4-2 unit path); live GPX ingest
    // yields the same band *policy* (ordering + expected===primary) but not identical ids/times.
    assert.ok(estimate.bands!.conservative!.finishElapsedSeconds > estimate.expectedFinishElapsedSeconds);
    assert.ok(estimate.bands!.aggressive!.finishElapsedSeconds < estimate.expectedFinishElapsedSeconds);

    const attach = await attachEstimate(app, roomId, ownerToken, estimate.id);
    assert.equal(attach.statusCode, 200, attach.body);
    const attached = parsePacingEstimate((attach.json() as { estimate: unknown }).estimate);
    assert.deepEqual(attached.bands, estimate.bands);

    const response = await getSchedule(app, roomId, ownerToken);
    assert.equal(response.statusCode, 200);
    const sheet = parseCrewScheduleSheet(response.json());
    assertEstimateBaseline(sheet, estimate);

    // Schedule uses expected baseline only — not conservative/aggressive (informational).
    let priorStoppage = 0;
    for (const id of ["start", "aid-1", "aid-2", "aid-3"] as const) {
      const stop = stopByCheckpoint(sheet, id);
      priorStoppage += stop.plannedStoppageSeconds + (stop.delayOverrideSeconds ?? 0);
    }
    const finishElapsed = stopByCheckpoint(sheet, "finish").elapsedSeconds;
    assert.equal(finishElapsed, estimate.expectedFinishElapsedSeconds + priorStoppage);
    assert.notEqual(finishElapsed, estimate.bands!.conservative!.finishElapsedSeconds + priorStoppage);
    assert.notEqual(finishElapsed, estimate.bands!.aggressive!.finishElapsedSeconds + priorStoppage);
  });
});

test("EC2: cutoff under/warn/breach statuses correct (with estimate attached)", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w4i-ec2");
    const roomId = await createPaidRoom(app, ownerToken, "W4-I EC2 cutoffs");
    const room = await put50kCourse(app, roomId, ownerToken);

    const long = await ingestGpx(app, ownerToken, "activity-long-trail.gpx", "gpx:w4i-ec2");
    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [long.id] });
    assert.equal((await attachEstimate(app, roomId, ownerToken, estimate.id)).statusCode, 200);

    const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    const aid1 = stopByCheckpoint(baseline, "aid-1").elapsedSeconds;
    const aid2 = stopByCheckpoint(baseline, "aid-2").elapsedSeconds;
    const aid3 = stopByCheckpoint(baseline, "aid-3").elapsedSeconds;

    const stored = await getRaceRoom(roomId);
    assert.ok(stored?.course);
    await saveRaceRoom({
      ...stored,
      course: {
        ...stored.course,
        checkpoints: applyCutoffById(stored.course.checkpoints, {
          "aid-1": { mode: "elapsed_from_start", seconds: aid1 + CUTOFF_WARN_MARGIN_SECONDS + 60 },
          "aid-2": { mode: "elapsed_from_start", seconds: aid2 + 300 },
          "aid-3": { mode: "elapsed_from_start", seconds: aid3 - 60 }
        })
      }
    });

    const sheet = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assert.equal(sheet.pacingEstimateId, estimate.id);
    assert.equal(stopByCheckpoint(sheet, "aid-1").cutoffStatus, "ok");
    assert.equal(stopByCheckpoint(sheet, "aid-1").cutoffMarginSeconds, CUTOFF_WARN_MARGIN_SECONDS + 60);
    assert.equal(stopByCheckpoint(sheet, "aid-2").cutoffStatus, "warn");
    assert.equal(stopByCheckpoint(sheet, "aid-2").cutoffMarginSeconds, 300);
    assert.equal(stopByCheckpoint(sheet, "aid-3").cutoffStatus, "breach");
    assert.equal(stopByCheckpoint(sheet, "aid-3").cutoffMarginSeconds, -60);
  });
});

test("EC3: delay flips cutoff status (estimate baseline retained)", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w4i-ec3");
    const roomId = await createPaidRoom(app, ownerToken, "W4-I EC3 delay flips");
    const room = await put50kCourse(app, roomId, ownerToken);

    const long = await ingestGpx(app, ownerToken, "activity-long-trail.gpx", "gpx:w4i-ec3");
    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [long.id] });
    assert.equal((await attachEstimate(app, roomId, ownerToken, estimate.id)).statusCode, 200);

    const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    const aid2Elapsed = stopByCheckpoint(baseline, "aid-2").elapsedSeconds;
    const cutoffElapsed = aid2Elapsed + CUTOFF_WARN_MARGIN_SECONDS + 60;

    const stored = await getRaceRoom(roomId);
    assert.ok(stored?.course);
    await saveRaceRoom({
      ...stored,
      course: {
        ...stored.course,
        checkpoints: applyCutoffById(stored.course.checkpoints, {
          "aid-2": { mode: "elapsed_from_start", seconds: cutoffElapsed }
        })
      }
    });

    const before = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assert.equal(stopByCheckpoint(before, "aid-2").cutoffStatus, "ok");
    assert.equal(before.pacingEstimateId, estimate.id);

    const delayResponse = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/stop-plans/aid-1`,
      payload: { delayOverrideSeconds: CUTOFF_WARN_MARGIN_SECONDS + 120 },
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(delayResponse.statusCode, 200);

    const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assert.equal(after.pacingEstimateId, estimate.id);
    assert.equal(stopByCheckpoint(after, "aid-2").cutoffStatus, "breach");
    assert.ok((stopByCheckpoint(after, "aid-2").cutoffMarginSeconds ?? 0) < 0);
  });
});

test("EC4: unauthorized schedule / attach → 401 / 403", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w4i-ec4");
    const strangerToken = tokenFor("stranger-w4i-ec4");
    const roomId = await createPaidRoom(app, ownerToken, "W4-I EC4 authz");
    const room = await put50kCourse(app, roomId, ownerToken);
    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [] });

    assert.equal((await getSchedule(app, roomId)).statusCode, 401);
    assert.equal((await getSchedule(app, roomId, strangerToken)).statusCode, 403);

    const unauthAttach = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/pacing-estimate`,
      payload: { pacingEstimateId: estimate.id }
    });
    assert.equal(unauthAttach.statusCode, 401);
  });
});

test("EC5: invalid estimate attach → 400", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w4i-ec5");
    const roomId = await createPaidRoom(app, ownerToken, "W4-I EC5 invalid attach");
    await put50kCourse(app, roomId, ownerToken);

    const missing = await attachEstimate(app, roomId, ownerToken, "est_does_not_exist");
    assert.equal(missing.statusCode, 400);
    assert.equal((missing.json() as { code?: string }).code, "invalid_estimate_id");
  });
});

test("EC6: estimate + cutoff schedule clocks remain ISO-Z", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w4i-ec6");
    const roomId = await createPaidRoom(app, ownerToken, "W4-I EC6 ISO-Z");
    const room = await put50kCourse(app, roomId, ownerToken, (cps) =>
      applyCutoffById(cps, {
        "aid-1": { mode: "elapsed_from_start", seconds: 50_000 },
        "aid-2": { mode: "time_of_day", hour: 18, minute: 0 }
      })
    );

    const long = await ingestGpx(app, ownerToken, "activity-long-trail.gpx", "gpx:w4i-ec6");
    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [long.id] });
    assert.equal((await attachEstimate(app, roomId, ownerToken, estimate.id)).statusCode, 200);

    const sheet = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assert.match(sheet.raceStartAt, ISO_Z);
    for (const stop of sheet.stops) {
      assert.match(stop.clockArrivalAt, ISO_Z);
    }
    assert.match(estimate.expectedFinishAt, ISO_Z);
    assert.match(estimate.bands!.conservative!.finishAt, ISO_Z);
    assert.match(estimate.bands!.aggressive!.finishAt, ISO_Z);
  });
});

test("EC7 N/A in API — DEV share export proved on simulator (see PR)", async () => {
  // Mobile EC7: `crewcue://dev/crew-sheet-export` via ios-simulator-agent-qa; evidence on PR only.
  assert.ok(existsSync(resolve(pacingDir, "schedule-expected.json")));
  assert.equal(typeof projectCrewScheduleSheet, "function");
});

test("EC8: coldStart estimate still has coarse bands; attach drives schedule", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w4i-ec8");
    const roomId = await createPaidRoom(app, ownerToken, "W4-I EC8 coldStart bands");
    const room = await put50kCourse(app, roomId, ownerToken);

    const estimate = await postEstimate(app, ownerToken, room, { historyRefIds: [] });
    assert.equal(estimate.coldStart, true);
    assertThreeBands(estimate);
    assert.deepEqual(estimate.bands, loadEstimateBandsFixture().coldStart.bands);

    const attach = await attachEstimate(app, roomId, ownerToken, estimate.id);
    assert.equal(attach.statusCode, 200, attach.body);

    const sheet = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assertEstimateBaseline(sheet, estimate);
  });
});
