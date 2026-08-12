import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_HISTORY_SOURCES,
  WAYPOINT_TAGS,
  isWaypointTag,
  parseActivityHistoryRef,
  parseCrewScheduleSheet,
  parseDistanceMeters,
  parseDurationSeconds,
  parseIso8601Utc,
  parsePacingEstimate,
  parseScheduleStop,
  parseWaypointTags,
  type ActivityHistoryRef,
  type CrewScheduleSheet,
  type PacingEstimate,
  type RaceCourseCheckpoint,
  type RaceCourseCheckpointCutoff,
  type ScheduleStop
} from "../src/index.ts";

const RACE_START = "2026-08-12T13:00:00.000Z";
const AID_CLOCK = "2026-08-12T16:30:00.000Z";
const FINISH_CLOCK = "2026-08-12T23:45:00.000Z";

function requiredStop(): ScheduleStop {
  return {
    id: "stop-aid-1",
    checkpointId: "cp-aid-1",
    clockArrivalAt: AID_CLOCK,
    elapsedSeconds: 12_600,
    plannedDwellSeconds: 180
  };
}

function historyBackedEstimate(): PacingEstimate {
  return {
    id: "est-1",
    coldStart: false,
    expectedFinishAt: FINISH_CLOCK,
    expectedFinishElapsedSeconds: 38_700,
    aidEtas: [
      { checkpointId: "cp-aid-1", clockArrivalAt: AID_CLOCK, elapsedSeconds: 12_600 }
    ],
    explanation: "History-backed estimate from two similar ultras.",
    historyRefIds: ["hist-1"]
  };
}

test("EC1: optional notes, bands, and history may be omitted", () => {
  const stop = parseScheduleStop(requiredStop());
  assert.equal(stop.notes, undefined);
  assert.equal(stop.delayOverrideSeconds, undefined);

  const estimate = parsePacingEstimate({
    id: "est-cold",
    coldStart: true,
    expectedFinishAt: FINISH_CLOCK,
    expectedFinishElapsedSeconds: 40_000,
    aidEtas: [],
    explanation: "Course-only coarse estimate."
  });
  assert.equal(estimate.bands, undefined);
  assert.equal(estimate.historyRefIds, undefined);
  assert.equal(estimate.coldStart, true);

  const history = parseActivityHistoryRef({
    id: "hist-1",
    source: "gpx_upload",
    externalId: "upload-abc",
    recordedAt: "2026-06-01T14:00:00.000Z",
    ingestedAt: "2026-08-01T09:00:00.000Z"
  });
  assert.equal(history.distanceMeters, undefined);
  assert.equal(history.elapsedSeconds, undefined);
  assert.equal(history.elevationGainMeters, undefined);
});

test("EC2: invalid waypoint tag is rejected and not coerced", () => {
  assert.equal(isWaypointTag("aid"), true);
  assert.equal(isWaypointTag("finish"), false);
  assert.equal(isWaypointTag("AID"), false);

  assert.throws(() => parseWaypointTags(["aid", "finish"]), /invalid waypoint tag: finish/);
  assert.throws(() => parseWaypointTags("aid"), /must be an array/);
  assert.deepEqual(parseWaypointTags(["aid", "crew"]), ["aid", "crew"]);
  assert.deepEqual([...WAYPOINT_TAGS], ["aid", "water", "dropbag", "crew"]);
});

test("EC5: history ref keeps stable source + externalId for idempotent replay", () => {
  const first: ActivityHistoryRef = parseActivityHistoryRef({
    id: "hist-row-1",
    source: "strava",
    externalId: "strava:12345",
    recordedAt: "2026-05-10T08:00:00.000Z",
    ingestedAt: "2026-08-10T12:00:00.000Z",
    distanceMeters: 50_000,
    elapsedSeconds: 18_000,
    elevationGainMeters: 1_200
  });
  const replay = parseActivityHistoryRef({
    id: "hist-row-2",
    source: first.source,
    externalId: first.externalId,
    recordedAt: first.recordedAt,
    ingestedAt: "2026-08-11T12:00:00.000Z"
  });
  assert.equal(replay.source, "strava");
  assert.equal(replay.externalId, "strava:12345");
  assert.deepEqual([...ACTIVITY_HISTORY_SOURCES], ["gpx_upload", "strava"]);
  assert.throws(() => parseActivityHistoryRef({ ...first, source: "garmin" }), /source must be/);
});

test("EC6: clock times are ISO-8601 UTC; durations seconds; distances meters", () => {
  assert.equal(parseIso8601Utc(RACE_START), RACE_START);
  assert.throws(() => parseIso8601Utc("2026-08-12T13:00:00"), /ISO-8601 UTC/);
  assert.throws(() => parseIso8601Utc("2026-08-12 13:00:00Z"), /ISO-8601 UTC/);
  assert.throws(() => parseIso8601Utc("not-a-date"), /ISO-8601 UTC/);

  assert.equal(parseDurationSeconds(180), 180);
  assert.throws(() => parseDurationSeconds(-1), /non-negative finite number of seconds/);
  assert.throws(() => parseDurationSeconds("180"), /non-negative finite number of seconds/);

  assert.equal(parseDistanceMeters(1609.34), 1609.34);
  assert.throws(() => parseDistanceMeters(-5), /non-negative finite number of meters/);

  const stop = parseScheduleStop({
    ...requiredStop(),
    clockArrivalAt: "2026-08-12T16:30:00Z",
    elapsedSeconds: 12_600,
    plannedDwellSeconds: 240.5
  });
  assert.equal(stop.clockArrivalAt, "2026-08-12T16:30:00Z");
  assert.equal(stop.elapsedSeconds, 12_600);
  assert.equal(stop.plannedDwellSeconds, 240.5);
});

test("EC7: multiple tags are allowed; empty tag list is an untagged landmark", () => {
  assert.deepEqual(parseWaypointTags([]), []);
  assert.deepEqual(parseWaypointTags(["aid", "water", "dropbag", "crew"]), [
    "aid",
    "water",
    "dropbag",
    "crew"
  ]);

  const tagged: RaceCourseCheckpoint = {
    id: "cp-aid-1",
    latitude: 39.1,
    longitude: -120.2,
    tags: ["aid", "crew"]
  };
  const untagged: RaceCourseCheckpoint = {
    id: "cp-landmark",
    latitude: 39.2,
    longitude: -120.3
  };
  assert.deepEqual(tagged.tags, ["aid", "crew"]);
  assert.equal(untagged.tags, undefined);
});

test("EC8: cold-start estimate does not require history ids", () => {
  const estimate = parsePacingEstimate({
    id: "est-cold",
    coldStart: true,
    expectedFinishAt: FINISH_CLOCK,
    expectedFinishElapsedSeconds: 42_000,
    aidEtas: [
      { checkpointId: "cp-aid-1", clockArrivalAt: AID_CLOCK, elapsedSeconds: 14_000 }
    ],
    explanation: "No history yet; coarse course-only estimate."
  });
  assert.equal(estimate.coldStart, true);
  assert.equal(estimate.historyRefIds, undefined);

  const withHistory = parsePacingEstimate(historyBackedEstimate());
  assert.equal(withHistory.coldStart, false);
  assert.deepEqual(withHistory.historyRefIds, ["hist-1"]);
});

test("existing checkpoint cutoff shapes stay valid (additive tags only)", () => {
  const timeOfDay: RaceCourseCheckpointCutoff = { mode: "time_of_day", hour: 17, minute: 30 };
  const elapsed: RaceCourseCheckpointCutoff = { mode: "elapsed_from_start", seconds: 36_000 };
  const checkpoint: RaceCourseCheckpoint = {
    id: "cp-1",
    latitude: 39.0,
    longitude: -120.0,
    plannedStopSeconds: 120,
    cutoff: timeOfDay
  };
  assert.equal(checkpoint.cutoff?.mode, "time_of_day");
  assert.equal(elapsed.seconds, 36_000);
  assert.equal("tags" in checkpoint, false);
});

test("crew schedule sheet parses fixture-shaped JSON including optional delay and notes", () => {
  const sheet: CrewScheduleSheet = parseCrewScheduleSheet({
    roomId: "room-1",
    raceStartAt: RACE_START,
    pacingEstimateId: "est-1",
    stops: [
      {
        ...requiredStop(),
        delayOverrideSeconds: 300,
        notes: { athleteNotesId: "note-a", planNotesId: "note-p" }
      }
    ]
  });
  assert.equal(sheet.stops[0]?.delayOverrideSeconds, 300);
  assert.deepEqual(sheet.stops[0]?.notes, { athleteNotesId: "note-a", planNotesId: "note-p" });

  const withBands = parsePacingEstimate({
    ...historyBackedEstimate(),
    bands: {
      conservative: { finishAt: "2026-08-13T01:00:00.000Z", finishElapsedSeconds: 43_200 },
      expected: { finishAt: FINISH_CLOCK, finishElapsedSeconds: 38_700 },
      aggressive: { finishAt: "2026-08-12T22:00:00.000Z", finishElapsedSeconds: 32_400 }
    }
  });
  assert.equal(withBands.bands?.conservative?.finishElapsedSeconds, 43_200);
  assert.throws(
    () => parsePacingEstimate({ ...historyBackedEstimate(), bands: { heat: { finishAt: FINISH_CLOCK, finishElapsedSeconds: 1 } } }),
    /invalid band: heat/
  );
});
