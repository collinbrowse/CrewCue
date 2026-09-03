/**
 * Deterministic pacing estimator unit tests (W3-3 edge matrix).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseActivityHistoryRef,
  parsePacingEstimate,
  type ActivityHistoryRef,
  type RaceCourseCheckpoint
} from "@crewcue/contracts";
import { buildRaceCourseFromGpx, parseGpxTrack } from "@crewcue/map-core";
import {
  DEFAULT_PACING_ESTIMATE_SEED,
  PacingEstimateCourseError,
  estimatePacingDeterministic
} from "./index.js";

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
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const RACE_START = "2026-08-15T13:00:00.000Z";

function loadCourseCheckpoints(): RaceCourseCheckpoint[] {
  const xml = readFileSync(resolve(pacingDir, "course-50k-with-aids.gpx"), "utf8");
  const { course } = buildRaceCourseFromGpx(parseGpxTrack(xml));
  return course.checkpoints;
}

function fixtureHistoryRefs(): { long: ActivityHistoryRef; short: ActivityHistoryRef } {
  const pack = JSON.parse(
    readFileSync(resolve(pacingDir, "schedule-expected.json"), "utf8")
  ) as { historyRefs: unknown[] };
  const long = parseActivityHistoryRef(pack.historyRefs[0]);
  const short = parseActivityHistoryRef({
    id: "hist-short-road",
    source: "gpx_upload",
    externalId: "gpx:activity-short-road",
    recordedAt: "2026-05-01T10:00:00.000Z",
    ingestedAt: "2026-08-01T09:00:00.000Z",
    distanceMeters: 8000,
    elapsedSeconds: 2400,
    elevationGainMeters: 25
  });
  return { long, short };
}

test("EC1: empty history returns cold-start coarse estimate without throwing", () => {
  const checkpoints = loadCourseCheckpoints();
  const estimate = estimatePacingDeterministic({
    raceStartAt: RACE_START,
    checkpoints,
    history: []
  });
  const parsed = parsePacingEstimate(estimate);
  assert.equal(parsed.coldStart, true);
  assert.equal(parsed.historyRefIds, undefined);
  assert.match(parsed.explanation, /cold start|No usable activity history/i);
  assert.ok(parsed.expectedFinishElapsedSeconds > 0);
  assert.ok(parsed.aidEtas.length >= 3);
  assert.match(parsed.expectedFinishAt, ISO_Z);
});

test("EC2: missing / incomplete course throws typed 4xx-mappable error", () => {
  assert.throws(
    () =>
      estimatePacingDeterministic({
        raceStartAt: RACE_START,
        checkpoints: [],
        history: []
      }),
    (err: unknown) => err instanceof PacingEstimateCourseError && err.code === "course_missing"
  );
  assert.throws(
    () =>
      estimatePacingDeterministic({
        raceStartAt: RACE_START,
        checkpoints: [{ id: "only", latitude: 0, longitude: 0, distanceMetersFromStart: 0 }],
        history: []
      }),
    (err: unknown) => err instanceof PacingEstimateCourseError && err.code === "course_incomplete"
  );
  assert.throws(
    () =>
      estimatePacingDeterministic({
        raceStartAt: RACE_START,
        checkpoints: [
          { id: "start", latitude: 0, longitude: 0 },
          { id: "finish", latitude: 1, longitude: 1 }
        ] as RaceCourseCheckpoint[],
        history: []
      }),
    (err: unknown) =>
      err instanceof PacingEstimateCourseError && err.code === "course_distance_missing"
  );
  assert.throws(
    () =>
      estimatePacingDeterministic({
        raceStartAt: "2026-08-15T13:00:00",
        checkpoints: [
          { id: "start", latitude: 0, longitude: 0, distanceMetersFromStart: 0 },
          { id: "finish", latitude: 1, longitude: 1, distanceMetersFromStart: 1000 }
        ],
        history: []
      }),
    (err: unknown) => err instanceof PacingEstimateCourseError && err.code === "race_start_invalid"
  );
});

test("EC5: duplicate estimate request yields identical body", () => {
  const checkpoints = loadCourseCheckpoints();
  const { long } = fixtureHistoryRefs();
  const input = {
    raceStartAt: RACE_START,
    checkpoints,
    history: [long],
    seed: DEFAULT_PACING_ESTIMATE_SEED
  };
  const first = estimatePacingDeterministic(input);
  const second = estimatePacingDeterministic(input);
  assert.deepEqual(first, second);
});

test("EC6: clocks are ISO-Z and match raceStartAt + elapsedSeconds", () => {
  const checkpoints = loadCourseCheckpoints();
  const { long } = fixtureHistoryRefs();
  const estimate = estimatePacingDeterministic({
    raceStartAt: RACE_START,
    checkpoints,
    history: [long]
  });
  const startMs = Date.parse(RACE_START);
  assert.match(estimate.expectedFinishAt, ISO_Z);
  assert.equal(
    (Date.parse(estimate.expectedFinishAt) - startMs) / 1000,
    estimate.expectedFinishElapsedSeconds
  );
  for (const eta of estimate.aidEtas) {
    assert.match(eta.clockArrivalAt, ISO_Z);
    assert.equal((Date.parse(eta.clockArrivalAt) - startMs) / 1000, eta.elapsedSeconds);
  }
  assert.equal(typeof estimate.expectedFinishElapsedSeconds, "number");
});

test("EC7: long vs short dissimilar history produces predictably different estimates", () => {
  const checkpoints = loadCourseCheckpoints();
  const { long, short } = fixtureHistoryRefs();
  const fromLong = estimatePacingDeterministic({
    raceStartAt: RACE_START,
    checkpoints,
    history: [long]
  });
  const fromShort = estimatePacingDeterministic({
    raceStartAt: RACE_START,
    checkpoints,
    history: [short]
  });
  const parsedShort = parsePacingEstimate(fromShort);
  assert.equal(parsedShort.coldStart, false);
  assert.deepEqual(parsedShort.historyRefIds, [short.id]);
  assert.match(parsedShort.explanation, /dissimilar to course distance/i);
  assert.ok(parsedShort.bands?.conservative);
  assert.equal(
    parsedShort.bands?.expected?.finishElapsedSeconds,
    parsedShort.expectedFinishElapsedSeconds
  );
  assert.notEqual(fromLong.expectedFinishElapsedSeconds, fromShort.expectedFinishElapsedSeconds);
  assert.ok(fromLong.expectedFinishElapsedSeconds > fromShort.expectedFinishElapsedSeconds);

  const both = estimatePacingDeterministic({
    raceStartAt: RACE_START,
    checkpoints,
    history: [long, short]
  });
  // Short road is dissimilar to ~50k; only long should back the estimate.
  assert.deepEqual(both.historyRefIds, [long.id]);
  assert.equal(both.expectedFinishElapsedSeconds, fromLong.expectedFinishElapsedSeconds);
  assert.match(both.explanation, /dissimilar excluded/i);
});

test("EC8: single history activity still produces a parseable estimate with ordered bands", () => {
  const checkpoints = loadCourseCheckpoints();
  const { long } = fixtureHistoryRefs();
  const estimate = estimatePacingDeterministic({
    raceStartAt: RACE_START,
    checkpoints,
    history: [long]
  });
  const parsed = parsePacingEstimate(estimate);
  assert.equal(parsed.coldStart, false);
  assert.deepEqual(parsed.historyRefIds, [long.id]);
  assert.ok(parsed.aidEtas.length >= 1);
  assert.ok(parsed.bands?.conservative);
  assert.ok(parsed.bands?.expected);
  assert.ok(parsed.bands?.aggressive);
  assert.equal(parsed.bands?.expected?.finishElapsedSeconds, parsed.expectedFinishElapsedSeconds);
  assert.ok(
    (parsed.bands!.conservative!.finishElapsedSeconds as number) >=
      (parsed.bands!.expected!.finishElapsedSeconds as number)
  );
  assert.ok(
    (parsed.bands!.expected!.finishElapsedSeconds as number) >=
      (parsed.bands!.aggressive!.finishElapsedSeconds as number)
  );
});
