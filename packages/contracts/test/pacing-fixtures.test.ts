import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PACING_FIXTURE_FILES,
  assertPacingFixturesPresent,
  inspectGpx,
  readPacingFixture,
  readPacingFixtureJson
} from "../../../fixtures/pacing/load.ts";
import {
  parseActivityHistoryRef,
  parseCrewScheduleSheet,
  parsePacingEstimate,
  type ActivityHistoryRef
} from "../src/index.ts";

test("required pacing fixtures exist (fails closed if a pack file is missing)", () => {
  const present = assertPacingFixturesPresent();
  assert.deepEqual(present, [...PACING_FIXTURE_FILES]);
  const unique = new Set(PACING_FIXTURE_FILES);
  assert.equal(unique.size, PACING_FIXTURE_FILES.length);
});

test("EC5: README documents each fixture path once", () => {
  const readme = readFileSync(new URL("../../../fixtures/pacing/README.md", import.meta.url), "utf8");
  for (const fileName of PACING_FIXTURE_FILES) {
    const matches = readme.match(new RegExp(`\`${fileName}\``, "g")) ?? [];
    assert.equal(matches.length, 1, `${fileName} should appear once in README`);
  }
});

// EC3 unauthorized: N/A — static fixture files, no authz surface.
// EC4 offline: N/A — tests read local files only; no network.

test("EC1: empty GPX is classified as an empty track without throwing", () => {
  const xml = readPacingFixture("empty.gpx");
  const inspected = inspectGpx(xml);
  assert.equal(inspected.kind, "empty");
  assert.equal(inspected.trackPointCount, 0);
});

test("EC2: corrupt GPX is classified as parse failure without throwing", () => {
  const xml = readPacingFixture("corrupt.gpx");
  const inspected = inspectGpx(xml);
  assert.equal(inspected.kind, "corrupt");
});

test("course GPX has start/finish plus at least three aid-like waypoints", () => {
  const inspected = inspectGpx(readPacingFixture("course-50k-with-aids.gpx"));
  assert.equal(inspected.kind, "track");
  assert.ok(inspected.trackPointCount >= 2);
  assert.ok(inspected.waypointCount >= 5);
  const xml = readPacingFixture("course-50k-with-aids.gpx");
  assert.match(xml, /<name>Start<\/name>/);
  assert.match(xml, /<name>Finish<\/name>/);
  assert.match(xml, /<name>Aid 1<\/name>/);
  assert.match(xml, /<name>Aid 2<\/name>/);
  assert.match(xml, /<name>Aid 3<\/name>/);
});

test("long-trail and short-road activities are clearly different", () => {
  const longInspect = inspectGpx(readPacingFixture("activity-long-trail.gpx"));
  const shortInspect = inspectGpx(readPacingFixture("activity-short-road.gpx"));
  assert.equal(longInspect.kind, "track");
  assert.equal(shortInspect.kind, "track");
  assert.ok(longInspect.trackPointCount > shortInspect.trackPointCount);
});

test("EC6: golden schedule JSON matches W0-1 units and parses as schedule + estimate", () => {
  const raw = readPacingFixtureJson("schedule-expected.json");
  assert.equal(typeof raw, "object");
  assert.ok(raw && typeof raw === "object");
  const pack = raw as Record<string, unknown>;
  assert.throws(() => parseCrewScheduleSheet(pack), /stops must be an array/);
  const sheet = parseCrewScheduleSheet(pack.sheet);
  const estimate = parsePacingEstimate(pack.estimate);
  assert.ok(Array.isArray(pack.historyRefs));
  const history = (pack.historyRefs as unknown[]).map((row) => parseActivityHistoryRef(row));

  const raceStartMs = Date.parse(sheet.raceStartAt);
  assert.match(sheet.raceStartAt, /Z$/);
  for (const stop of sheet.stops) {
    assert.match(stop.clockArrivalAt, /Z$/);
    assert.equal(typeof stop.elapsedSeconds, "number");
    assert.equal(typeof stop.plannedDwellSeconds, "number");
    assert.equal(
      (Date.parse(stop.clockArrivalAt) - raceStartMs) / 1000,
      stop.elapsedSeconds,
      `${stop.checkpointId} clockArrivalAt must equal raceStartAt + elapsedSeconds`
    );
  }
  assert.equal(typeof estimate.expectedFinishElapsedSeconds, "number");
  assert.match(estimate.expectedFinishAt, /Z$/);
  assert.equal(
    (Date.parse(estimate.expectedFinishAt) - raceStartMs) / 1000,
    estimate.expectedFinishElapsedSeconds
  );
  for (const eta of estimate.aidEtas) {
    assert.equal(
      (Date.parse(eta.clockArrivalAt) - raceStartMs) / 1000,
      eta.elapsedSeconds,
      `${eta.checkpointId} aidEta clock must equal raceStartAt + elapsedSeconds`
    );
  }
  const hist: ActivityHistoryRef = history[0]!;
  assert.equal(typeof hist.distanceMeters, "number");
  assert.ok((hist.distanceMeters ?? 0) > 1000);
  assert.equal(hist.source, "gpx_upload");
  assert.equal(hist.externalId, "gpx:activity-long-trail");
  assert.equal(hist.elevationGainMeters, 4568);
});

test("EC7: missing required golden field fails closed", () => {
  const pack = readPacingFixtureJson("schedule-expected.json") as Record<string, unknown>;
  const sheet = { ...(pack.sheet as Record<string, unknown>) };
  delete sheet.raceStartAt;
  assert.throws(() => parseCrewScheduleSheet(sheet), /raceStartAt/);

  const estimate = { ...(pack.estimate as Record<string, unknown>) };
  delete estimate.explanation;
  assert.throws(() => parsePacingEstimate(estimate), /explanation/);
});

test("strava mock summary maps to an ActivityHistoryRef without a live API", () => {
  const summary = readPacingFixtureJson("strava-activity-summary.json") as Record<string, unknown>;
  const mapped = parseActivityHistoryRef({
    id: "hist-strava-8k",
    source: "strava",
    externalId: String(summary.external_id ?? summary.id),
    recordedAt: summary.start_date,
    ingestedAt: "2026-08-01T09:00:00.000Z",
    distanceMeters: summary.distance,
    elapsedSeconds: summary.elapsed_time,
    elevationGainMeters: summary.total_elevation_gain
  });
  assert.equal(mapped.source, "strava");
  assert.equal(mapped.distanceMeters, 8000);
  assert.equal(mapped.elapsedSeconds, 2520);
  assert.equal(mapped.elevationGainMeters, 40);
  assert.match(String(summary.start_date), /Z$/);
  assert.doesNotMatch(String(summary.start_date_local), /Z$/);
});
