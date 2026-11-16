import test from "node:test";
import assert from "node:assert/strict";
import type {
  CrewScheduleSheet,
  RaceCheckpointSplitRow,
  RaceCourseCheckpoint,
  RaceRoom,
  RaceRoomProjection
} from "@crewcue/contracts";
import { roomUnpaidError } from "./billingEntitlement.js";
import { isTeaserRoom, teaserCheckpointsOf, teaserProjection, teaserRoom, teaserScheduleSheet } from "./raceTeaser.js";

function cp(id: string, distance: number | undefined, tags?: RaceCourseCheckpoint["tags"]): RaceCourseCheckpoint {
  return {
    id,
    latitude: 0,
    longitude: 0,
    ...(distance !== undefined ? { distanceMetersFromStart: distance } : {}),
    ...(tags ? { tags } : {})
  };
}

function room(checkpoints: RaceCourseCheckpoint[], status: RaceRoom["entitlement"]["status"] = "unpaid"): RaceRoom {
  return {
    id: "room-1",
    teamId: "team-1",
    athleteId: "runner",
    name: "Teaser",
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    memberships: [{ userId: "runner", role: "athlete", joinedAt: "2026-08-01T00:00:00.000Z" }],
    entitlement: { status, lastUpdatedAt: "2026-08-01T00:00:00.000Z", source: "manual", crewTier: "one" },
    course: {
      checkpoints,
      baselineTrack: {
        points: [
          { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
          { distanceMetersFromStart: 30_000, referenceElapsedSeconds: 18_000 }
        ]
      }
    }
  };
}

const COURSE = [
  cp("start", 0, ["aid"]),
  cp("water-1", 5_000, ["water"]),
  cp("aid-a", 10_000, ["aid", "crew"]),
  cp("aid-b", 20_000, ["aid"]),
  cp("finish", 30_000, ["aid"])
];

function split(checkpointId: string, distance: number): RaceCheckpointSplitRow {
  return {
    checkpointId,
    distanceMetersFromStart: distance,
    crossedAtRecordedAt: null,
    plannedElapsedSecondsAtCross: distance / 2,
    actualElapsedSecondsAtCross: null,
    deltaSecondsAtCross: null,
    plannedStopSeconds: 0,
    visits: [],
    totalActualStopSeconds: null,
    deltaStopSeconds: null
  };
}

test("first aid station comes from the aid tag, never the start or the finish", () => {
  const picked = teaserCheckpointsOf(room(COURSE));
  assert.equal(picked.startCheckpointId, "start");
  assert.equal(picked.firstAidCheckpointId, "aid-a");
  assert.equal(picked.finishCheckpointId, "finish");
  assert.deepEqual(picked.lockedCheckpointIds, ["water-1", "aid-b"]);
});

test("course order is by distance, not by list position", () => {
  const shuffled = [COURSE[3]!, COURSE[4]!, COURSE[0]!, COURSE[2]!, COURSE[1]!];
  const picked = teaserCheckpointsOf(room(shuffled));
  assert.equal(picked.startCheckpointId, "start");
  assert.equal(picked.firstAidCheckpointId, "aid-a");
  assert.equal(picked.finishCheckpointId, "finish");
  assert.deepEqual(picked.lockedCheckpointIds, ["water-1", "aid-b"]);
});

test("without distances the listed order stands", () => {
  const picked = teaserCheckpointsOf(room([cp("a", undefined), cp("b", undefined, ["aid"]), cp("c", 5)]));
  assert.equal(picked.startCheckpointId, "a");
  assert.equal(picked.firstAidCheckpointId, "b");
  assert.equal(picked.finishCheckpointId, "c");
  assert.deepEqual(picked.lockedCheckpointIds, []);
});

test("no aid-tagged stop: only the start and finish show, everything between is locked", () => {
  const picked = teaserCheckpointsOf(room([cp("start", 0), cp("cp-1", 10), cp("cp-2", 20), cp("finish", 30)]));
  assert.equal(picked.firstAidCheckpointId, undefined);
  assert.deepEqual(picked.lockedCheckpointIds, ["cp-1", "cp-2"]);

  const projection = teaserProjection(
    { checkpointSplits: [split("start", 0), split("cp-1", 10), split("finish", 30)] } as RaceRoomProjection,
    room([cp("start", 0), cp("cp-1", 10), cp("cp-2", 20), cp("finish", 30)])
  );
  assert.deepEqual(projection.checkpointSplits, []);
});

test("no course: nothing to show or lock", () => {
  const bare = { ...room([]), course: undefined };
  assert.deepEqual(teaserCheckpointsOf(bare), { lockedCheckpointIds: [] });
  assert.equal(teaserRoom(bare).course, undefined);
});

test("projection teaser keeps the first aid entries and course-level fields only", () => {
  const projection = {
    roomId: "room-1",
    etaFinishPlanIso: "2026-08-15T21:20:00.000Z",
    courseLengthMeters: 30_000,
    etaFinishWindow: { earliestIso: "2026-08-15T21:00:00.000Z", latestIso: "2026-08-15T22:00:00.000Z" },
    checkpointSplits: COURSE.map((checkpoint) => split(checkpoint.id, checkpoint.distanceMetersFromStart!)),
    remainingCheckpointEtas: ["aid-a", "aid-b", "finish"].map((checkpointId) => ({
      checkpointId,
      liveProjectedElapsedSeconds: 1,
      frozenPlanElapsedSeconds: 1,
      deltaSecondsVsFrozenPlan: 0
    }))
  } as RaceRoomProjection;
  const shaped = teaserProjection(projection, room(COURSE));
  assert.deepEqual(shaped.checkpointSplits.map((row) => row.checkpointId), ["aid-a"]);
  assert.deepEqual(shaped.remainingCheckpointEtas?.map((eta) => eta.checkpointId), ["aid-a"]);
  assert.equal(shaped.etaFinishPlanIso, projection.etaFinishPlanIso);
  assert.deepEqual(shaped.etaFinishWindow, projection.etaFinishWindow);
  assert.deepEqual(shaped.locked, { checkpointIds: ["water-1", "aid-b"] });
  assert.equal(projection.checkpointSplits.length, 5, "input is not mutated");

  const { remainingCheckpointEtas: _absent, ...withoutRemaining } = projection;
  const noRemaining = teaserProjection(withoutRemaining as RaceRoomProjection, room(COURSE));
  assert.equal(noRemaining.remainingCheckpointEtas, undefined);
  assert.deepEqual(noRemaining.locked, { checkpointIds: ["water-1", "aid-b"] });
});

test("schedule teaser keeps the start, first aid and finish stops", () => {
  const sheet: CrewScheduleSheet = {
    roomId: "room-1",
    raceStartAt: "2026-08-15T13:00:00.000Z",
    pacingEstimateId: "est-1",
    stops: COURSE.map((checkpoint, index) => ({
      id: `stop-${checkpoint.id}`,
      checkpointId: checkpoint.id,
      clockArrivalAt: "2026-08-15T13:00:00.000Z",
      elapsedSeconds: index * 1000,
      plannedStoppageSeconds: 0
    }))
  };
  const shaped = teaserScheduleSheet(sheet, room(COURSE));
  assert.deepEqual(shaped.stops.map((stop) => stop.checkpointId), ["start", "aid-a", "finish"]);
  assert.deepEqual(shaped.locked, { checkpointIds: ["water-1", "aid-b"] });
  assert.equal(shaped.pacingEstimateId, "est-1");
  assert.equal(sheet.stops.length, 5, "input is not mutated");
});

test("room teaser drops the plan curve and later aid ETAs, and leaves the cached room alone", () => {
  const original = {
    ...room(COURSE),
    pacingEstimate: {
      id: "est-1",
      coldStart: true,
      expectedFinishAt: "2026-08-15T21:20:00.000Z",
      expectedFinishElapsedSeconds: 30_000,
      explanation: "fixture",
      aidEtas: ["water-1", "aid-a", "aid-b"].map((checkpointId) => ({
        checkpointId,
        clockArrivalAt: "2026-08-15T15:00:00.000Z",
        elapsedSeconds: 7_200
      }))
    }
  };
  const before = structuredClone(original);
  const shaped = teaserRoom(original);
  assert.equal(shaped.course?.baselineTrack, undefined);
  assert.deepEqual(shaped.course?.checkpoints, COURSE, "the checkpoint list stays for the map");
  assert.deepEqual(shaped.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), ["aid-a"]);
  assert.equal(shaped.pacingEstimate?.expectedFinishAt, original.pacingEstimate.expectedFinishAt);
  assert.deepEqual(original, before, "input is not mutated");
});

test("only an unpaid race is a teaser, and only an unpaid race refuses crew with room_unpaid", () => {
  assert.equal(isTeaserRoom(room(COURSE, "unpaid")), true);
  assert.equal(isTeaserRoom(room(COURSE, "paid")), false);
  assert.equal(isTeaserRoom(room(COURSE, "expired")), false);
  assert.deepEqual(roomUnpaidError(room(COURSE, "unpaid")), { error: "Race not unlocked", code: "room_unpaid" });
  assert.equal(roomUnpaidError(room(COURSE, "paid")), undefined);
  assert.equal(roomUnpaidError(room(COURSE, "expired")), undefined);
});
