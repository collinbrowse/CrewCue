import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRaceCourseFromGpx, computeElevationGainMeters, parseGpxTrack } from "./courseParse.js";

const pacingDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/pacing");

function readPacingGpx(fileName: string): string {
  return readFileSync(resolve(pacingDir, fileName), "utf8");
}

test("course and activity pacing fixtures parse as GPX tracks", () => {
  const course = parseGpxTrack(readPacingGpx("course-50k-with-aids.gpx"));
  assert.ok(course.totalDistanceMeters > 45_000);
  assert.ok(course.totalDistanceMeters < 55_000);
  assert.ok(course.waypoints.length >= 5);

  const { course: raceCourse } = buildRaceCourseFromGpx(course);
  assert.deepEqual(
    raceCourse.checkpoints.map((checkpoint) => checkpoint.id),
    ["start", "aid-1", "aid-2", "aid-3", "finish"]
  );

  const longTrail = parseGpxTrack(readPacingGpx("activity-long-trail.gpx"));
  const shortRoad = parseGpxTrack(readPacingGpx("activity-short-road.gpx"));
  const longGain = computeElevationGainMeters(longTrail.points);
  const shortGain = computeElevationGainMeters(shortRoad.points);
  assert.ok(longTrail.totalDistanceMeters > 40_000);
  assert.ok(shortRoad.totalDistanceMeters < 12_000);
  assert.ok(longGain > shortGain + 1000);

  const pack = JSON.parse(readFileSync(resolve(pacingDir, "schedule-expected.json"), "utf8")) as {
    historyRefs: Array<{ distanceMeters?: number; elevationGainMeters?: number }>;
  };
  const hist = pack.historyRefs[0];
  assert.ok(hist);
  assert.equal(Math.round(longGain), hist.elevationGainMeters);
  assert.ok(Math.abs(longTrail.totalDistanceMeters - (hist.distanceMeters ?? 0)) < 100);
});

test("empty pacing GPX is an empty track (parser throws; harness does not)", () => {
  assert.throws(() => parseGpxTrack(readPacingGpx("empty.gpx")), /at least two track points/);
});

test("corrupt pacing GPX is a parse failure (parser throws; harness does not)", () => {
  assert.throws(() => parseGpxTrack(readPacingGpx("corrupt.gpx")));
});
