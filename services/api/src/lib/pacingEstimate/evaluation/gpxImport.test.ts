/**
 * GPX → corpus effort import. Edge cases EC1–EC7 carried over from #499, plus course-order arrival.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RaceCourseCheckpoint } from "@crewcue/contracts";
import { parseEvaluationEffort } from "./corpus.js";
import {
  AID_NEAR_METERS,
  buildEffortFromGpx,
  extractMovingSplits,
  GpxImportError,
  historyFromTrainingGpx,
  isStoppageSegment,
  STOPPAGE_MAX_SPEED_METERS_PER_SEC,
  type TimedPoint
} from "./gpxImport.js";
import { findPacingFixturesDir } from "./testSupport.js";

const FIXTURES = findPacingFixturesDir();
const COURSE_GPX = readFileSync(resolve(FIXTURES, "course-50k-with-aids.gpx"), "utf8");
const TRAINING_GPX = readFileSync(resolve(FIXTURES, "activity-long-trail.gpx"), "utf8");
const START = { latitude: 39.15, longitude: -120.25 };

function north(meters: number): number {
  return START.latitude + meters / 111_320;
}

function at(meters: number, seconds: number): TimedPoint {
  return { latitude: north(meters), longitude: START.longitude, timestampMs: seconds * 1000 };
}

function checkpoint(id: string, meters: number): RaceCourseCheckpoint {
  return { id, title: id, latitude: north(meters), longitude: START.longitude, distanceMetersFromStart: meters };
}

const LINE = [checkpoint("start", 0), checkpoint("aid-1", 2000), checkpoint("finish", 4000)];
const OWN = { kind: "own-effort" as const, contributor: "test", consent: "fixture" };

test("EC1: race GPX without timestamps fails clearly", () => {
  assert.throws(() => extractMovingSplits([at(0, 0)], LINE), (error: unknown) => {
    assert.ok(error instanceof GpxImportError);
    assert.equal(error.code, "race_missing_timestamps");
    return true;
  });
  const untimed = COURSE_GPX.replace(/<time>[^<]*<\/time>/g, "");
  assert.throws(
    () => buildEffortFromGpx({ id: "x", group: "g", provenance: OWN, coursePath: "c.gpx", courseGpxXml: COURSE_GPX, raceGpxXml: untimed, trainingGpxXmls: [] }),
    /timestamps/
  );
});

test("EC2–EC4: stoppage needs BOTH near a checkpoint and slow", () => {
  const stations = [START];
  assert.equal(isStoppageSegment(at(0, 0), at(5, 60), stations), true, "EC2 near + slow");
  const racePace = 3; // m/s
  assert.ok(racePace > STOPPAGE_MAX_SPEED_METERS_PER_SEC);
  assert.equal(isStoppageSegment(at(0, 0), at(30, 10), stations), false, "EC3 near + race pace");
  assert.equal(isStoppageSegment(at(1000, 0), at(1001, 60), stations), false, "EC4 far + slow");
  assert.ok(AID_NEAR_METERS < 1000);
});

test("stoppage near an aid is excluded from moving elapsed; stops elsewhere are not", () => {
  const points = [
    at(0, 0),
    at(1000, 400),
    at(1001, 700), // 5 min stop far from any aid → still moving time
    at(2000, 1100), // arrive aid-1
    at(2002, 1700), // 10 min at aid-1 → stoppage
    at(4000, 2500) // finish
  ];
  const splits = extractMovingSplits(points, LINE);
  assert.deepEqual(splits, [
    { checkpointId: "aid-1", actualElapsedSeconds: 1100 },
    { checkpointId: "finish", actualElapsedSeconds: 2500 - 600 }
  ]);
});

test("EC5: an unvisited checkpoint fails with its name", () => {
  const points = [at(0, 0), at(1000, 400), at(4000, 1600)];
  assert.throws(() => extractMovingSplits(points, LINE), (error: unknown) => {
    assert.ok(error instanceof GpxImportError);
    assert.equal(error.code, "aid_not_visited");
    assert.match(error.message, /aid-1/);
    return true;
  });
});

test("checkpoints are matched in course order (out-and-back aid scored on the right pass)", () => {
  // aid-2 sits where the runner passes on the way out; it is only "reached" after aid-1 (turnaround).
  const course = [checkpoint("start", 0), checkpoint("aid-1", 3000), { ...checkpoint("aid-2", 4000), latitude: north(1000) }, checkpoint("finish", 6000)];
  const points = [at(0, 0), at(1000, 300), at(3000, 900), at(1000, 1500), at(0, 1800)];
  const finishAtStart = { ...course[3]!, latitude: north(0) };
  const splits = extractMovingSplits(points, [course[0]!, course[1]!, course[2]!, finishAtStart]);
  assert.deepEqual(splits.map((split) => [split.checkpointId, split.actualElapsedSeconds]), [
    ["aid-1", 900],
    ["aid-2", 1500],
    ["finish", 1800]
  ]);
});

test("EC6/EC7: training GPX → summary row; untimed training GPX fails clearly", () => {
  const row = historyFromTrainingGpx(TRAINING_GPX, { id: "h1", ingestedAt: "2026-09-01T00:00:00.000Z", label: "long.gpx" });
  assert.ok((row.distanceMeters ?? 0) > 0 && (row.elapsedSeconds ?? 0) > 0);
  assert.throws(
    () => historyFromTrainingGpx(TRAINING_GPX.replace(/<time>[^<]*<\/time>/g, ""), { id: "h2", ingestedAt: "2026-09-01T00:00:00.000Z", label: "untimed.gpx" }),
    (error: unknown) => error instanceof GpxImportError && error.code === "history_missing_elapsed" && /untimed\.gpx/.test(error.message)
  );
});

test("buildEffortFromGpx: timed course track round-trips into a valid corpus effort", () => {
  const effort = buildEffortFromGpx({
    id: "fixture-roundtrip",
    group: "fixture",
    provenance: OWN,
    coursePath: "courses/fixture.gpx",
    courseGpxXml: COURSE_GPX,
    // The fixture course track carries timestamps, so it doubles as a race recording.
    raceGpxXml: COURSE_GPX,
    trainingGpxXmls: []
  });
  const reparsed = parseEvaluationEffort(JSON.parse(JSON.stringify(effort)));
  assert.equal(reparsed.history.length, 0, "EC6: zero training files is a cold-start effort");
  assert.deepEqual(reparsed.actualSplits.map((split) => split.checkpointId), ["aid-1", "aid-2", "aid-3", "finish"]);
  const seconds = reparsed.actualSplits.map((split) => split.actualElapsedSeconds);
  assert.deepEqual([...seconds].sort((a, b) => a - b), seconds);
  assert.equal(reparsed.raceStartAt, "2026-08-15T13:00:00.000Z");
});
