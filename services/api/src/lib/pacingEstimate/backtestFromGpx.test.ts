/**
 * GPX → moving splits + history for pacing backtest (stoppage, not dwell).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RaceCourseCheckpoint } from "@crewcue/contracts";
import { runPacingBacktest } from "./backtest.js";
import {
  AID_NEAR_METERS,
  GpxBacktestError,
  STOPPAGE_MAX_SPEED_METERS_PER_SEC,
  buildBacktestScenarioFromGpx,
  extractHistoryFromTrainingGpx,
  extractMovingSplitsFromTimedPoints,
  isStoppageSegment,
  type TimedPoint
} from "./backtestFromGpx.js";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "course-50k-with-aids.gpx"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing/course-50k-with-aids.gpx not found");
}

const FIXTURES_DIR = findPacingFixturesDir();
const COURSE_GPX = readFileSync(resolve(FIXTURES_DIR, "course-50k-with-aids.gpx"), "utf8");
const HISTORY_GPX = readFileSync(resolve(FIXTURES_DIR, "activity-long-trail.gpx"), "utf8");

const AID = { latitude: 39.15, longitude: -120.25 };

function offsetNorth(lat: number, meters: number): number {
  return lat + meters / 111_320;
}

function timed(latitude: number, longitude: number, timestampMs: number): TimedPoint {
  return { latitude, longitude, timestampMs };
}

function checkpointsAlongNorth(): RaceCourseCheckpoint[] {
  return [
    {
      id: "start",
      title: "Start",
      latitude: AID.latitude,
      longitude: AID.longitude,
      distanceMetersFromStart: 0
    },
    {
      id: "aid-1",
      title: "Aid 1",
      latitude: offsetNorth(AID.latitude, 200),
      longitude: AID.longitude,
      distanceMetersFromStart: 200
    },
    {
      id: "finish",
      title: "Finish",
      latitude: offsetNorth(AID.latitude, 400),
      longitude: AID.longitude,
      distanceMetersFromStart: 400
    }
  ];
}

test("EC2: near aid + slow counts as stoppage", () => {
  const atAid = timed(AID.latitude, AID.longitude, 0);
  const stillAtAid = timed(offsetNorth(AID.latitude, 5), AID.longitude, 60_000);
  assert.equal(isStoppageSegment(atAid, stillAtAid, [AID]), true);
});

test("EC3: near aid + race pace is not stoppage", () => {
  const a = timed(AID.latitude, AID.longitude, 0);
  const b = timed(offsetNorth(AID.latitude, 20), AID.longitude, 2_000);
  const speed = 20 / 2;
  assert.ok(speed > STOPPAGE_MAX_SPEED_METERS_PER_SEC);
  assert.equal(isStoppageSegment(a, b, [AID]), false);
});

test("EC4: far from aid + slow is not stoppage", () => {
  const farLat = offsetNorth(AID.latitude, 200);
  const a = timed(farLat, AID.longitude, 0);
  const b = timed(offsetNorth(farLat, 5), AID.longitude, 60_000);
  assert.equal(isStoppageSegment(a, b, [AID]), false);
});

test("stoppage near aid is excluded from later moving elapsed (EC2 on splits)", () => {
  const cps = checkpointsAlongNorth();
  const aid1 = cps[1]!;
  const finish = cps[2]!;
  const t0 = 1_700_000_000_000;
  const points: TimedPoint[] = [
    timed(cps[0]!.latitude, cps[0]!.longitude, t0),
    timed(aid1.latitude, aid1.longitude, t0 + 200_000),
    timed(offsetNorth(aid1.latitude, 3), aid1.longitude, t0 + 200_000 + 600_000),
    timed(finish.latitude, finish.longitude, t0 + 200_000 + 600_000 + 200_000)
  ];
  const splits = extractMovingSplitsFromTimedPoints(points, cps);
  const aidSplit = splits.find((row) => row.checkpointId === "aid-1");
  const finishSplit = splits.find((row) => row.checkpointId === "finish");
  assert.ok(aidSplit);
  assert.ok(finishSplit);
  assert.equal(aidSplit.actualElapsedSeconds, 200);
  assert.equal(finishSplit.actualElapsedSeconds, 400);
});

test("EC1: missing race timestamps fails clearly", () => {
  const cps = checkpointsAlongNorth();
  assert.throws(
    () => extractMovingSplitsFromTimedPoints([timed(AID.latitude, AID.longitude, 1)], cps),
    (err: unknown) => err instanceof GpxBacktestError && err.code === "race_missing_timestamps"
  );
});

test("EC5: course aid never visited fails clearly", () => {
  const cps = checkpointsAlongNorth();
  const t0 = 1_700_000_000_000;
  const points: TimedPoint[] = [
    timed(cps[0]!.latitude, cps[0]!.longitude, t0),
    timed(cps[1]!.latitude, cps[1]!.longitude, t0 + 200_000)
  ];
  assert.throws(
    () => extractMovingSplitsFromTimedPoints(points, cps),
    (err: unknown) =>
      err instanceof GpxBacktestError &&
      err.code === "aid_not_visited" &&
      /Finish/i.test(err.message)
  );
});

test("EC7: history GPX without elapsed fails clearly", () => {
  const untimed = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
    <trk><trkseg>
      <trkpt lat="39.2" lon="-120.4"><ele>600</ele></trkpt>
      <trkpt lat="39.21" lon="-120.4"><ele>610</ele></trkpt>
    </trkseg></trk></gpx>`;
  assert.throws(
    () =>
      extractHistoryFromTrainingGpx(untimed, {
        id: "hist-1",
        ingestedAt: "2026-09-14T00:00:00.000Z",
        label: "untimed.gpx"
      }),
    (err: unknown) => err instanceof GpxBacktestError && err.code === "history_missing_elapsed"
  );
});

test("EC6: zero training files still builds a cold-start scenario from real course GPX", () => {
  const scenario = buildBacktestScenarioFromGpx({
    name: "course as race",
    courseGpxXml: COURSE_GPX,
    raceGpxXml: COURSE_GPX,
    trainingGpxXmls: [],
    ingestedAt: "2026-09-14T00:00:00.000Z"
  });
  assert.equal(scenario.history.length, 0);
  assert.ok(scenario.actualSplits.length >= 3);
  const result = runPacingBacktest(scenario);
  assert.equal(result.coldStart, true);
  assert.ok(result.scoredRowCount >= 3);
});

test("training GPX fills history; AID_NEAR_METERS is 75", () => {
  assert.equal(AID_NEAR_METERS, 75);
  const row = extractHistoryFromTrainingGpx(HISTORY_GPX, {
    id: "hist-1",
    ingestedAt: "2026-09-14T00:00:00.000Z"
  });
  assert.ok((row.elapsedSeconds ?? 0) > 0);
  assert.ok((row.distanceMeters ?? 0) > 0);
  const scenario = buildBacktestScenarioFromGpx({
    courseGpxXml: COURSE_GPX,
    raceGpxXml: COURSE_GPX,
    trainingGpxXmls: [HISTORY_GPX],
    ingestedAt: "2026-09-14T00:00:00.000Z"
  });
  assert.equal(scenario.history.length, 1);
  assert.equal(runPacingBacktest(scenario).coldStart, false);
});
