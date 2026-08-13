/**
 * Pacing estimate API route tests (W3-3).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseActivityHistoryRef, parsePacingEstimate, type RaceCourseCheckpoint } from "@crewcue/contracts";
import { buildRaceCourseFromGpx, parseGpxTrack } from "@crewcue/map-core";
import { buildApp } from "../app.js";
import { resetActivityHistoryStoreForTests } from "../lib/activityHistoryStore.js";
import { resetPacingEstimateStoreForTests } from "../lib/pacingEstimateStore.js";
import { DEFAULT_PACING_ESTIMATE_SEED } from "../lib/pacingEstimate/index.js";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "course-50k-with-aids.gpx"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found");
}

const pacingDir = findPacingFixturesDir();
const RACE_START = "2026-08-15T13:00:00.000Z";
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function readPacingGpx(fileName: string): string {
  return readFileSync(resolve(pacingDir, fileName), "utf8");
}

function loadCourseCheckpoints(): RaceCourseCheckpoint[] {
  const xml = readPacingGpx("course-50k-with-aids.gpx");
  const { course } = buildRaceCourseFromGpx(parseGpxTrack(xml));
  return course.checkpoints;
}

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

async function withApp(
  run: (ctx: {
    app: ReturnType<typeof buildApp>;
    tokenFor: (sub: string) => string;
  }) => Promise<void>
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

async function ingestGpx(
  app: ReturnType<typeof buildApp>,
  token: string,
  fileName: string,
  externalId: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/activity-history/gpx",
    headers: { authorization: `Bearer ${token}` },
    payload: { gpxXml: readPacingGpx(fileName), externalId }
  });
  assert.ok(response.statusCode === 201 || response.statusCode === 200, response.body);
  return parseActivityHistoryRef(response.json());
}

test("EC3: unauthorized estimate request returns 401; wrong athleteUserId returns 403", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const checkpoints = loadCourseCheckpoints();
    const unauth = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      payload: { raceStartAt: RACE_START, checkpoints }
    });
    assert.equal(unauth.statusCode, 401);

    const token = tokenFor("athlete-1");
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

test("EC2 API: corrupt / missing course returns 400", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
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

    const badStart = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        raceStartAt: "not-a-date",
        checkpoints: loadCourseCheckpoints()
      }
    });
    assert.equal(badStart.statusCode, 400);
  });
});

test("EC1 API: empty history yields cold-start estimate (200, no throw)", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
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
    assert.match(estimate.expectedFinishAt, ISO_Z);
  });
});

test("EC5 API: duplicate requests return identical bodies", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
    const long = await ingestGpx(app, token, "activity-long-trail.gpx", "gpx:activity-long-trail");
    const payload = {
      raceStartAt: RACE_START,
      checkpoints: loadCourseCheckpoints(),
      historyRefIds: [long.id],
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
  });
});

test("fixture history + course returns parseable PacingEstimate with aid ETAs", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
    const long = await ingestGpx(app, token, "activity-long-trail.gpx", "gpx:activity-long-trail");
    await ingestGpx(app, token, "activity-short-road.gpx", "gpx:activity-short-road");

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
    assert.deepEqual(estimate.historyRefIds, [long.id]);
    assert.ok(estimate.aidEtas.some((eta) => eta.checkpointId === "aid-1"));
    assert.ok(estimate.aidEtas.some((eta) => eta.checkpointId === "aid-3"));
    assert.match(estimate.explanation, /dissimilar excluded/i);
  });
});
