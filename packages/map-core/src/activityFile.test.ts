import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActivityFileError,
  MAX_ACTIVITY_FILE_BYTES,
  detectActivityFileFormat,
  parseActivityFile,
  type ActivityFileErrorCode
} from "./activityFile.js";
import { encodeFitActivity } from "./fitTestEncoder.js";

const pacingDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/pacing");
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(pacingDir, name)));

function assertCode(fn: () => unknown, code: ActivityFileErrorCode) {
  assert.throws(fn, (err: unknown) => err instanceof ActivityFileError && err.code === code);
}

test("FIT, TCX and GPX fixtures of the same run agree", () => {
  const gpx = parseActivityFile(fixture("activity-short-road.gpx"), "activity-short-road.gpx");
  const fit = parseActivityFile(fixture("activity-short-road.fit"), "activity-short-road.fit");
  const tcx = parseActivityFile(fixture("activity-short-road.tcx"), "activity-short-road.tcx");
  assert.equal(fit.format, "fit");
  assert.equal(tcx.format, "tcx");
  for (const parsed of [fit, tcx]) {
    assert.ok(Math.abs(parsed.distanceMeters - gpx.distanceMeters) < 1, `${parsed.format} distance`);
    assert.equal(parsed.elapsedSeconds, gpx.elapsedSeconds);
    assert.equal(parsed.startTimestampMs, gpx.startTimestampMs);
    assert.equal(parsed.points.length, gpx.points.length);
    assert.ok(Math.abs(parsed.elevationGainMeters! - gpx.elevationGainMeters!) < 1);
    assert.ok(Math.abs(parsed.points[5]!.latitude - gpx.points[5]!.latitude) < 1e-6);
  }
});

test("treadmill FIT without GPS imports distance and time without a track", () => {
  const parsed = parseActivityFile(fixture("activity-treadmill.fit"), "treadmill.fit");
  assert.equal(parsed.points.length, 0);
  assert.equal(parsed.distanceMeters, 6000);
  assert.equal(parsed.elapsedSeconds, 1800);
  assert.equal(parsed.elevationGainMeters, null);
});

test("FIT without session or distance is rejected clearly", () => {
  const bytes = encodeFitActivity({ records: [{ timestampMs: Date.UTC(2026, 4, 1) }, { timestampMs: Date.UTC(2026, 4, 1, 0, 1) }] });
  assertCode(() => parseActivityFile(bytes, "x.fit"), "file_no_activity");
});

test("FIT compressed-timestamp records decode their clock", () => {
  const start = Date.UTC(2026, 4, 1, 6, 0, 0);
  const records = Array.from({ length: 10 }, (_, index) => ({
    timestampMs: start + index * 7_000,
    latitude: 40 + index * 0.0005,
    longitude: -105,
    distanceMeters: index * 55
  }));
  const parsed = parseActivityFile(encodeFitActivity({ records, compressedTimestamps: true }), "c.fit");
  assert.equal(parsed.startTimestampMs, start);
  assert.equal(parsed.elapsedSeconds, 63);
  assert.equal(parsed.distanceMeters, 495);
});

test("non-activity FIT files are unsupported", () => {
  const bytes = encodeFitActivity({ fileType: 6, records: [], session: { startMs: Date.UTC(2026, 0, 1), elapsedSeconds: 60, distanceMeters: 100 } });
  assertCode(() => parseActivityFile(bytes, "course.fit"), "file_unsupported");
});

test("corrupt and truncated files show a read error", () => {
  assertCode(() => parseActivityFile(fixture("corrupt.fit"), "corrupt.fit"), "file_corrupt");
  const fit = fixture("activity-short-road.fit");
  const flipped = fit.slice();
  flipped[100] = flipped[100]! ^ 0xff;
  assertCode(() => parseActivityFile(flipped, "flipped.fit"), "file_corrupt");
  assertCode(
    () => parseActivityFile(new TextEncoder().encode("<TrainingCenterDatabase><Activities>"), "cut.tcx"),
    "file_corrupt"
  );
});

test("empty, unsupported and oversized files are rejected", () => {
  assertCode(() => parseActivityFile(new Uint8Array(), "a.fit"), "file_empty");
  assertCode(() => parseActivityFile(new TextEncoder().encode("hello"), "notes.txt"), "file_unsupported");
  assertCode(() => parseActivityFile(new Uint8Array(MAX_ACTIVITY_FILE_BYTES + 1), "big.fit"), "file_too_large");
});

test("format detection prefers content over the file name", () => {
  assert.equal(detectActivityFileFormat(fixture("activity-short-road.fit"), "run.gpx"), "fit");
  assert.equal(detectActivityFileFormat(fixture("activity-short-road.tcx"), "run.bin"), "tcx");
  assert.equal(detectActivityFileFormat(fixture("activity-short-road.gpx")), "gpx");
  assert.equal(detectActivityFileFormat(new TextEncoder().encode("x"), "RUN.TCX"), "tcx");
  assert.equal(detectActivityFileFormat(new TextEncoder().encode("x"), "run.kml"), null);
});
