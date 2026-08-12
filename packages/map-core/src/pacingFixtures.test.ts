import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGpxTrack } from "./courseParse.js";

const pacingDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/pacing");

function readPacingGpx(fileName: string): string {
  return readFileSync(resolve(pacingDir, fileName), "utf8");
}

test("course and activity pacing fixtures parse as GPX tracks", () => {
  const course = parseGpxTrack(readPacingGpx("course-50k-with-aids.gpx"));
  assert.ok(course.totalDistanceMeters > 45_000);
  assert.ok(course.totalDistanceMeters < 55_000);
  assert.ok(course.waypoints.length >= 5);

  const longTrail = parseGpxTrack(readPacingGpx("activity-long-trail.gpx"));
  const shortRoad = parseGpxTrack(readPacingGpx("activity-short-road.gpx"));
  assert.ok(longTrail.totalDistanceMeters > 40_000);
  assert.ok(shortRoad.totalDistanceMeters < 12_000);
  assert.ok((longTrail.points[0]?.elevationMeters ?? 0) > (shortRoad.points[0]?.elevationMeters ?? 0) + 100);
});

test("empty pacing GPX is an empty track (parser throws; harness does not)", () => {
  assert.throws(() => parseGpxTrack(readPacingGpx("empty.gpx")), /at least two track points/);
});

test("corrupt pacing GPX is a parse failure (parser throws; harness does not)", () => {
  assert.throws(() => parseGpxTrack(readPacingGpx("corrupt.gpx")));
});
