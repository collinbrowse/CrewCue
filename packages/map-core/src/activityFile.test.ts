import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActivityFileError,
  MAX_ACTIVITY_FILE_BYTES,
  MAX_ACTIVITY_NAME_CHARS,
  cleanActivityName,
  detectActivityFileFormat,
  isFootActivity,
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

test("sport comes from the FIT session, TCX Activity and GPX type", () => {
  const records = [0, 1, 2].map((i) => ({ timestampMs: Date.parse("2026-05-10T15:30:00Z") + i * 60_000, latitude: 45 + i * 0.001, longitude: -120, distanceMeters: i * 111 }));
  const session = { startMs: records[0]!.timestampMs, elapsedSeconds: 120, distanceMeters: 222 };
  assert.equal(parseActivityFile(encodeFitActivity({ records, session: { ...session, sport: 1, subSport: 3 } }), "a.fit").sport, "trail_running");
  assert.equal(parseActivityFile(encodeFitActivity({ records, session: { ...session, sport: 2 } }), "b.fit").sport, "cycling");
  assert.equal(parseActivityFile(encodeFitActivity({ records, session }), "c.fit").sport, null);
  assert.equal(parseActivityFile(fixture("activity-short-road.tcx"), "r.tcx").sport, "running");
  assert.equal(isFootActivity("hiking"), true);
  assert.equal(isFootActivity(null), true);
  assert.equal(isFootActivity("cycling"), false);
  assert.equal(isFootActivity("walking"), false);
});

test("activity names come from GPX trk/metadata, TCX Activity Notes and the FIT workout", () => {
  const gpx = new TextDecoder().decode(fixture("activity-short-road.gpx"));
  assert.equal(parseActivityFile(fixture("activity-short-road.gpx"), "r.gpx").name, "Short road 8k history");
  // Strava: <metadata> has only a time; the track carries the title and type.
  const strava = gpx.replace(
    /<trk>\s*<name>[^<]*<\/name>/,
    "<trk>\n    <name>  Morning   Run &amp; Coffee </name>\n    <type>running</type>"
  ).replace("<trk>", "<metadata><time>2026-05-10T15:30:00Z</time></metadata>\n  <trk>");
  assert.equal(parseActivityFile(new TextEncoder().encode(strava), "s.gpx").name, "Morning Run & Coffee");
  const metadataOnly = gpx
    .replace(/<trk>\s*<name>[^<]*<\/name>/, "<trk>")
    .replace("<trk>", "<metadata><name>Lunch Run</name><link href=\"x\"><text>Garmin</text></link></metadata>\n  <trk>");
  assert.equal(parseActivityFile(new TextEncoder().encode(metadataOnly), "m.gpx").name, "Lunch Run");
  const unnamed = gpx.replace(/<trk>\s*<name>[^<]*<\/name>/, "<trk>");
  assert.equal(parseActivityFile(new TextEncoder().encode(unnamed), "u.gpx").name, null);

  const tcx = new TextDecoder().decode(fixture("activity-short-road.tcx"));
  assert.equal(parseActivityFile(fixture("activity-short-road.tcx"), "r.tcx").name, null);
  const notedTcx = tcx
    .replace(/<Id>/, "<Notes>Tempo Tuesday</Notes>\n      <Id>")
    .replace(/<Intensity>/, "<Notes>lap note</Notes><Intensity>");
  assert.equal(parseActivityFile(new TextEncoder().encode(notedTcx), "n.tcx").name, "Tempo Tuesday");
  const lapNoteOnly = tcx.replace(/<Intensity>/, "<Notes>lap note</Notes><Intensity>");
  assert.equal(parseActivityFile(new TextEncoder().encode(lapNoteOnly), "l.tcx").name, null);

  const records = [0, 1, 2].map((i) => ({ timestampMs: Date.parse("2026-05-10T15:30:00Z") + i * 60_000, latitude: 45 + i * 0.001, longitude: -120, distanceMeters: i * 111 }));
  const session = { startMs: records[0]!.timestampMs, elapsedSeconds: 120, distanceMeters: 222 };
  assert.equal(parseActivityFile(encodeFitActivity({ records, session, workoutName: "6x800 m" }), "w.fit").name, "6x800 m");
  assert.equal(parseActivityFile(encodeFitActivity({ records, session }), "c.fit").name, null);
  assert.equal(parseActivityFile(fixture("activity-short-road.fit"), "r.fit").name, null);
});

test("activity names are trimmed, decoded and capped", () => {
  assert.equal(cleanActivityName("  \n  "), null);
  assert.equal(cleanActivityName(undefined), null);
  assert.equal(cleanActivityName("<![CDATA[Hill <repeats>]]>"), "Hill <repeats>");
  assert.equal(cleanActivityName("Caf&#233; loop &#x1F3C3;"), "Café loop 🏃");
  const long = "x".repeat(MAX_ACTIVITY_NAME_CHARS + 30);
  assert.equal(cleanActivityName(long)!.length, MAX_ACTIVITY_NAME_CHARS);
});
