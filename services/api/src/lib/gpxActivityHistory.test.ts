import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fingerprintGpxExternalId,
  GpxActivityParseError,
  parseGpxActivityMetrics
} from "./gpxActivityHistory.js";

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

test("parseGpxActivityMetrics extracts metrics from long-trail fixture", () => {
  const metrics = parseGpxActivityMetrics(readPacingGpx("activity-long-trail.gpx"));
  assert.equal(metrics.recordedAt, "2026-06-01T14:00:00.000Z");
  assert.ok(metrics.distanceMeters > 40_000);
  assert.ok((metrics.elapsedSeconds ?? 0) > 0);
  assert.ok((metrics.elevationGainMeters ?? 0) > 1000);
});

test("parseGpxActivityMetrics rejects empty and corrupt fixtures", () => {
  assert.throws(
    () => parseGpxActivityMetrics(readPacingGpx("empty.gpx")),
    (err: unknown) => err instanceof GpxActivityParseError && err.code === "gpx_empty"
  );
  assert.throws(
    () => parseGpxActivityMetrics(readPacingGpx("corrupt.gpx")),
    (err: unknown) => err instanceof GpxActivityParseError
  );
  assert.throws(
    () => parseGpxActivityMetrics("   "),
    (err: unknown) => err instanceof GpxActivityParseError && err.code === "gpx_empty"
  );
});

test("parseGpxActivityMetrics does not let a planned rte inflate pace vs the recorded trk", () => {
  const recorded = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <trk><trkseg>
    <trkpt lat="37.78" lon="-122.42"><time>2026-05-10T15:30:00Z</time></trkpt>
    <trkpt lat="37.85" lon="-122.42"><time>2026-05-10T16:10:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
  const mixed = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <rte>
    <rtept lat="39.15" lon="-120.25"></rtept>
    <rtept lat="39.60" lon="-120.25"></rtept>
  </rte>
  <trk><trkseg>
    <trkpt lat="37.78" lon="-122.42"><time>2026-05-10T15:30:00Z</time></trkpt>
    <trkpt lat="37.85" lon="-122.42"><time>2026-05-10T16:10:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
  const trackMetrics = parseGpxActivityMetrics(recorded);
  const mixedMetrics = parseGpxActivityMetrics(mixed);
  assert.equal(mixedMetrics.elapsedSeconds, trackMetrics.elapsedSeconds);
  assert.ok(Math.abs((mixedMetrics.distanceMeters ?? 0) - (trackMetrics.distanceMeters ?? 0)) < 1);
});

test("fingerprintGpxExternalId is stable for identical GPX", () => {
  const gpx = readPacingGpx("activity-short-road.gpx");
  assert.equal(fingerprintGpxExternalId(gpx), fingerprintGpxExternalId(gpx));
  assert.notEqual(fingerprintGpxExternalId(gpx), fingerprintGpxExternalId(gpx + "\n"));
});
