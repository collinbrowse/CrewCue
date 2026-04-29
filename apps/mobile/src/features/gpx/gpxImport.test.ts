import test from "node:test";
import assert from "node:assert/strict";
import { buildExpectedSplits, formatDistanceKm, formatPace, parseGpxTrack } from "./gpxImport";

const validGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-test">
  <trk>
    <name>Demo route</name>
    <trkseg>
      <trkpt lat="40.712776" lon="-74.005974"><ele>10.2</ele><time>2026-04-29T12:00:00Z</time></trkpt>
      <trkpt lat="40.717776" lon="-74.000974"><ele>11.0</ele><time>2026-04-29T12:05:00Z</time></trkpt>
      <trkpt lat="40.722776" lon="-73.995974"><ele>12.0</ele><time>2026-04-29T12:10:00Z</time></trkpt>
      <trkpt lat="40.727776" lon="-73.990974"><ele>12.8</ele><time>2026-04-29T12:15:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

test("parseGpxTrack parses points and pace from valid GPX", () => {
  const parsed = parseGpxTrack(validGpx);
  assert.equal(parsed.points.length, 4);
  assert.ok(parsed.totalDistanceMeters > 2000);
  assert.equal(parsed.totalDurationSeconds, 900);
  assert.ok(parsed.averagePaceSecondsPerKm > 300);
});

test("buildExpectedSplits creates kilometer split rows", () => {
  const parsed = parseGpxTrack(validGpx);
  const splits = buildExpectedSplits(parsed, "km");
  assert.ok(splits.length >= 2);
  assert.equal(splits[0].distanceLabel, "1 km");
  assert.match(splits[0].elapsedLabel, /^\d+:\d{2}$/);
});

test("buildExpectedSplits creates mile split rows", () => {
  const parsed = parseGpxTrack(validGpx);
  const splits = buildExpectedSplits(parsed, "mi");
  assert.ok(splits.length >= 1);
  assert.equal(splits[0].distanceLabel, "1 mi");
});

test("parseGpxTrack rejects missing timestamps", () => {
  const noTimeGpx = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="1" lon="1"></trkpt><trkpt lat="1.1" lon="1.1"></trkpt></trkseg></trk></gpx>`;
  assert.throws(
    () => parseGpxTrack(noTimeGpx),
    /missing timestamps required for expected split times/
  );
});

test("format helpers stay presenter friendly", () => {
  assert.equal(formatDistanceKm(3210), "3.21 km");
  assert.equal(formatPace(345), "5:45/km");
});
