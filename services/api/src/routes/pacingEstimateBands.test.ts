/**
 * W4-2 (#411): confidence / A-B bands on pacing estimates.
 * Proof for issue edge-case matrix EC1–EC9 (API-only).
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
  type RaceCourseCheckpoint,
  type RaceRoom
} from "@crewcue/contracts";
import { buildRaceCourseFromGpx, flattenWorkspaceGeometry, parseGpxTrack } from "@crewcue/map-core";
import { buildApp } from "../app.js";
import { resetActivityHistoryStoreForTests } from "../lib/activityHistoryStore.js";
import {
  DEFAULT_PACING_ESTIMATE_SEED,
  estimatePacingMicroModelWithArtifacts
} from "../lib/pacingEstimate/index.js";
import { resetPacingEstimateStoreForTests } from "../lib/pacingEstimateStore.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "estimate-bands.json"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found");
}

const pacingDir = findPacingFixturesDir();
const RACE_START = "2026-08-15T13:00:00.000Z";
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

type BandPack = {
  policy: {
    bandMethod?: string;
    conservativeRatio?: number;
    aggressiveRatio?: number;
  };
  historyBacked: {
    id: string;
    coldStart: boolean;
    expectedFinishAt: string;
    expectedFinishElapsedSeconds: number;
    bands: NonNullable<PacingEstimate["bands"]>;
    historyRefIds: string[];
  };
  coldStart: {
    id: string;
    coldStart: boolean;
    expectedFinishAt: string;
    expectedFinishElapsedSeconds: number;
    bands: NonNullable<PacingEstimate["bands"]>;
  };
};

function loadBandPack(): BandPack {
  return JSON.parse(readFileSync(resolve(pacingDir, "estimate-bands.json"), "utf8")) as BandPack;
}

function loadCourseCheckpoints(): RaceCourseCheckpoint[] {
  const xml = readFileSync(resolve(pacingDir, "course-50k-with-aids.gpx"), "utf8");
  const { course } = buildRaceCourseFromGpx(parseGpxTrack(xml));
  return course.checkpoints;
}

function routeMetricPointsFor50k() {
  const { routeOverlayLayer } = load50kCourseWithAids();
  return flattenWorkspaceGeometry(routeOverlayLayer.geometry).map((coord) => {
    const t = coord as [number, number, number?];
    return {
      longitude: t[0],
      latitude: t[1],
      elevationMeters: typeof t[2] === "number" ? t[2] : null
    };
  });
}

function estimateMicro(history: import("@crewcue/contracts").ActivityHistoryRef[]) {
  const { checkpoints } = load50kCourseWithAids();
  return estimatePacingMicroModelWithArtifacts({
    raceStartAt: RACE_START,
    checkpoints,
    history,
    seed: DEFAULT_PACING_ESTIMATE_SEED,
    routeMetricPoints: routeMetricPointsFor50k(),
    courseLengthMeters: checkpoints[checkpoints.length - 1]?.distanceMetersFromStart
  }).estimate;
}

function fixtureLongHistory() {
  const pack = JSON.parse(readFileSync(resolve(pacingDir, "schedule-expected.json"), "utf8")) as {
    historyRefs: unknown[];
  };
  return parseActivityHistoryRef(pack.historyRefs[0]);
}

function assertThreeBands(estimate: PacingEstimate) {
  assert.ok(estimate.bands, "bands required");
  assert.ok(estimate.bands.conservative, "conservative band");
  assert.ok(estimate.bands.expected, "expected band");
  assert.ok(estimate.bands.aggressive, "aggressive band");
  assert.equal(
    estimate.bands.expected.finishElapsedSeconds,
    estimate.expectedFinishElapsedSeconds,
    "expected band matches primary finish"
  );
  assert.equal(estimate.bands.expected.finishAt, estimate.expectedFinishAt);
}

function assertBandOrdering(estimate: PacingEstimate) {
  assertThreeBands(estimate);
  const c = estimate.bands!.conservative!.finishElapsedSeconds;
  const e = estimate.bands!.expected!.finishElapsedSeconds;
  const a = estimate.bands!.aggressive!.finishElapsedSeconds;
  assert.ok(c >= e, `conservative ${c} >= expected ${e}`);
  assert.ok(e >= a, `expected ${e} >= aggressive ${a}`);
}

function assertBandClocksIsoZ(estimate: PacingEstimate) {
  assertThreeBands(estimate);
  const startMs = Date.parse(estimate.expectedFinishAt) - estimate.expectedFinishElapsedSeconds * 1000;
  for (const kind of ["conservative", "expected", "aggressive"] as const) {
    const point = estimate.bands![kind]!;
    assert.match(point.finishAt, ISO_Z, `${kind}.finishAt`);
    assert.equal(
      (Date.parse(point.finishAt) - startMs) / 1000,
      point.finishElapsedSeconds,
      `${kind} clock = raceStart + elapsed`
    );
  }
}

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

type TestApp = ReturnType<typeof buildApp>;

async function withApp(
  run: (ctx: { app: TestApp; tokenFor: (sub: string) => string }) => Promise<void>
): Promise<void> {
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

async function ingestLongTrail(app: TestApp, token: string) {
  const response = await app.inject({
    method: "POST",
    url: "/activity-history/gpx",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      gpxXml: readFileSync(resolve(pacingDir, "activity-long-trail.gpx"), "utf8"),
      externalId: "gpx:activity-long-trail"
    }
  });
  assert.ok(response.statusCode === 201 || response.statusCode === 200, response.body);
  return parseActivityHistoryRef(response.json());
}

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
      raceStartAt: RACE_START
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(response.statusCode, 200);
  return response.json() as RaceRoom;
}

function stopByCheckpoint(sheet: CrewScheduleSheet, checkpointId: string) {
  const stop = sheet.stops.find((row) => row.checkpointId === checkpointId);
  assert.ok(stop, `missing schedule stop ${checkpointId}`);
  return stop;
}

test("spread policy uses scenario re-sims (estimate-bands fixture)", () => {
  const pack = loadBandPack();
  assert.equal(pack.policy.bandMethod, "scenario_resim");
});

test("EC1: history-backed estimate has three bands; expected matches primary finish (fixture)", () => {
  const pack = loadBandPack();
  const long = fixtureLongHistory();
  const estimate = estimateMicro([long]);
  assert.equal(estimate.coldStart, false);
  assertThreeBands(estimate);
  assert.equal(estimate.id, pack.historyBacked.id);
  assert.equal(estimate.expectedFinishElapsedSeconds, pack.historyBacked.expectedFinishElapsedSeconds);
  assert.deepEqual(estimate.bands, pack.historyBacked.bands);
  assert.deepEqual(estimate.historyRefIds, pack.historyBacked.historyRefIds);
});

test("EC1 API: POST /pacing-estimates history-backed returns three bands", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-bands-ec1");
    await ingestLongTrail(app, token);
    const response = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        raceStartAt: RACE_START,
        checkpoints: loadCourseCheckpoints(),
        seed: DEFAULT_PACING_ESTIMATE_SEED
      }
    });
    assert.equal(response.statusCode, 200);
    const estimate = parsePacingEstimate(response.json());
    assert.equal(estimate.coldStart, false);
    assertThreeBands(estimate);
    assertBandOrdering(estimate);
  });
});

test("EC2: coldStart estimate returns three coarse bands (same spread policy)", () => {
  const pack = loadBandPack();
  const estimate = estimateMicro([]);
  assert.equal(estimate.coldStart, true);
  assertThreeBands(estimate);
  assert.equal(estimate.id, pack.coldStart.id);
  assert.deepEqual(estimate.bands, pack.coldStart.bands);
  assertBandOrdering(estimate);
});

test("EC2 API: empty history still returns three bands", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-bands-ec2");
    const response = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        raceStartAt: RACE_START,
        checkpoints: loadCourseCheckpoints(),
        historyRefIds: [],
        seed: DEFAULT_PACING_ESTIMATE_SEED
      }
    });
    assert.equal(response.statusCode, 200);
    const estimate = parsePacingEstimate(response.json());
    assert.equal(estimate.coldStart, true);
    assertThreeBands(estimate);
  });
});

test("EC3: invalid estimate body still returns 400", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-bands-ec3");
    const missing = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${token}` },
      payload: { raceStartAt: RACE_START }
    });
    assert.equal(missing.statusCode, 400);

    const incomplete = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        raceStartAt: RACE_START,
        checkpoints: [{ id: "only", latitude: 0, longitude: 0, distanceMetersFromStart: 0 }]
      }
    });
    assert.equal(incomplete.statusCode, 400);
  });
});

test("EC4: unauthorized estimate returns 401; wrong athleteUserId returns 403", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const checkpoints = loadCourseCheckpoints();
    const unauth = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      payload: { raceStartAt: RACE_START, checkpoints }
    });
    assert.equal(unauth.statusCode, 401);

    const token = tokenFor("athlete-bands-ec4");
    const forbidden = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        raceStartAt: RACE_START,
        checkpoints,
        athleteUserId: "someone-else"
      }
    });
    assert.equal(forbidden.statusCode, 403);
  });
});

test("EC5: N/A offline — in-process estimator (documented)", () => {
  // Offline / network retry is N/A for the pure in-process estimator + HTTP inject tests.
  assert.equal(typeof estimatePacingMicroModelWithArtifacts, "function");
});

test("EC6: re-estimate yields identical bands; re-attach returns same estimate bands", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-bands-ec6");
    await ingestLongTrail(app, token);
    const payload = {
      raceStartAt: RACE_START,
      checkpoints: loadCourseCheckpoints(),
      seed: DEFAULT_PACING_ESTIMATE_SEED
    };
    const first = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${token}` },
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${token}` },
      payload
    });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.deepEqual(first.json(), second.json());
    const estimate = parsePacingEstimate(first.json());
    assertThreeBands(estimate);

    const roomId = await createPaidRoom(app, token, "EC6 bands re-attach");
    await put50kCourse(app, roomId, token);
    const attach1 = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/pacing-estimate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { pacingEstimateId: estimate.id }
    });
    assert.equal(attach1.statusCode, 200, attach1.body);
    const attach2 = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/pacing-estimate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { pacingEstimateId: estimate.id }
    });
    assert.equal(attach2.statusCode, 200);
    const attached = parsePacingEstimate((attach2.json() as { estimate: unknown }).estimate);
    assert.deepEqual(attached.bands, estimate.bands);
  });
});

test("EC7: all band clocks are ISO-Z", () => {
  const history = estimateMicro([fixtureLongHistory()]);
  const cold = estimateMicro([]);
  assertBandClocksIsoZ(history);
  assertBandClocksIsoZ(cold);
});

test("EC8: band ordering conservative ≥ expected ≥ aggressive (fixture + live)", () => {
  const pack = loadBandPack();
  for (const sample of [pack.historyBacked, pack.coldStart]) {
    const c = sample.bands.conservative!.finishElapsedSeconds;
    const e = sample.bands.expected!.finishElapsedSeconds;
    const a = sample.bands.aggressive!.finishElapsedSeconds;
    assert.ok(c >= e && e >= a, JSON.stringify(sample.bands));
  }
  const estimate = estimateMicro([fixtureLongHistory()]);
  assertBandOrdering(estimate);
});

test("EC9: schedule moving-time uses expected baseline; bands informational on attach", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-bands-ec9");
    await ingestLongTrail(app, token);
    const estimateResponse = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        raceStartAt: RACE_START,
        checkpoints: loadCourseCheckpoints(),
        seed: DEFAULT_PACING_ESTIMATE_SEED
      }
    });
    assert.equal(estimateResponse.statusCode, 200);
    const estimate = parsePacingEstimate(estimateResponse.json());
    assertThreeBands(estimate);
    assert.notEqual(
      estimate.bands!.conservative!.finishElapsedSeconds,
      estimate.expectedFinishElapsedSeconds
    );

    const roomId = await createPaidRoom(app, token, "EC9 expected baseline");
    await put50kCourse(app, roomId, token);
    const attach = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/pacing-estimate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { pacingEstimateId: estimate.id }
    });
    assert.equal(attach.statusCode, 200, attach.body);
    const attached = parsePacingEstimate((attach.json() as { estimate: unknown }).estimate);
    assert.deepEqual(attached.bands, estimate.bands);

    const scheduleResponse = await app.inject({
      method: "GET",
      url: `/race-rooms/${roomId}/schedule`,
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(scheduleResponse.statusCode, 200);
    const sheet = parseCrewScheduleSheet(scheduleResponse.json());
    assert.equal(sheet.pacingEstimateId, estimate.id);

    // Finish moving time (before stoppage stack) comes from expected, not conservative/aggressive.
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
