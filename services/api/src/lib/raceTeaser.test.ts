import test from "node:test";
import assert from "node:assert/strict";
import type {
  CrewScheduleSheet,
  PacingEstimate,
  RaceCheckpointSplitRow,
  RaceCourseCheckpoint,
  RaceRoom,
  RaceRoomProjection
} from "@crewcue/contracts";
import { isRunnerSeat, roomUnpaidError } from "./billingEntitlement.js";
import {
  exportedEstimate,
  finishOnlyEstimate,
  isTeaserRoom,
  lockedRoom,
  roomForViewer,
  teaserCheckpointsOf,
  teaserProjection,
  teaserRoom,
  teaserScheduleSheet
} from "./raceTeaser.js";

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
const MID_COURSE = ["water-1", "aid-a", "aid-b"];

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

function estimate(aidIds: string[], id = "est-1"): PacingEstimate {
  return {
    id,
    coldStart: true,
    expectedFinishAt: "2026-08-15T21:20:00.000Z",
    expectedFinishElapsedSeconds: 30_000,
    explanation: "fixture",
    bands: { conservative: { finishAt: "2026-08-15T22:00:00.000Z", finishElapsedSeconds: 32_400 } },
    aidEtas: aidIds.map((checkpointId, index) => ({
      checkpointId,
      clockArrivalAt: "2026-08-15T15:00:00.000Z",
      elapsedSeconds: 3_600 * (index + 1)
    }))
  };
}

test("the start and finish show; every checkpoint between them is locked, whatever its tags", () => {
  const shown = teaserCheckpointsOf(room(COURSE));
  assert.deepEqual(shown, { startCheckpointId: "start", finishCheckpointId: "finish", lockedCheckpointIds: MID_COURSE });

  // Re-tagging changes nothing: tags never pick a stop to show.
  for (const tag of ["aid", "water", "crew"] as const) {
    const retagged = COURSE.map((checkpoint) => ({ ...checkpoint, tags: [tag] }));
    assert.deepEqual(teaserCheckpointsOf(room(retagged)).lockedCheckpointIds, MID_COURSE);
  }
  const untagged = COURSE.map(({ tags: _tags, ...checkpoint }) => checkpoint);
  assert.deepEqual(teaserCheckpointsOf(room(untagged)).lockedCheckpointIds, MID_COURSE);
});

test("course order is by distance, not by list position", () => {
  const shuffled = [COURSE[3]!, COURSE[4]!, COURSE[0]!, COURSE[2]!, COURSE[1]!];
  assert.deepEqual(teaserCheckpointsOf(room(shuffled)), {
    startCheckpointId: "start",
    finishCheckpointId: "finish",
    lockedCheckpointIds: MID_COURSE
  });
});

test("without distances the listed order stands", () => {
  assert.deepEqual(teaserCheckpointsOf(room([cp("a", undefined), cp("b", undefined, ["aid"]), cp("c", 5)])), {
    startCheckpointId: "a",
    finishCheckpointId: "c",
    lockedCheckpointIds: ["b"]
  });
});

test("no course: nothing to show or lock", () => {
  const bare = { ...room([]), course: undefined };
  assert.deepEqual(teaserCheckpointsOf(bare), { lockedCheckpointIds: [] });
  assert.equal(teaserRoom(bare).course, undefined);
});

test("projection teaser keeps the finish ETA and course-level fields, and no checkpoint rows", () => {
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
  assert.deepEqual(shaped.checkpointSplits, []);
  assert.deepEqual(shaped.remainingCheckpointEtas, []);
  assert.equal(shaped.etaFinishPlanIso, projection.etaFinishPlanIso);
  assert.deepEqual(shaped.etaFinishWindow, projection.etaFinishWindow);
  assert.equal(shaped.courseLengthMeters, 30_000);
  assert.deepEqual(shaped.locked, { checkpointIds: MID_COURSE });
  assert.equal(projection.checkpointSplits.length, 5, "input is not mutated");

  const { remainingCheckpointEtas: _absent, ...withoutRemaining } = projection;
  const noRemaining = teaserProjection(withoutRemaining as RaceRoomProjection, room(COURSE));
  assert.equal(noRemaining.remainingCheckpointEtas, undefined);
  assert.deepEqual(noRemaining.locked, { checkpointIds: MID_COURSE });
});

test("pre-race projection teaser: the finish from the start line, whatever checkpoint is listed first", () => {
  const withStops: RaceRoom = {
    ...room(COURSE.map((checkpoint) => ({ ...checkpoint, plannedStopSeconds: 60 }))),
    raceStartAt: "2026-08-15T13:00:00.000Z"
  };
  const bootstrap = {
    roomId: "room-1",
    asOfPingId: "bootstrap",
    asOfRecordedAt: "2026-08-01T00:00:00.000Z",
    progressMeters: 20_000,
    courseLengthMeters: 30_000,
    plannedPaceSecondsPerKm: 360,
    // As if the runner listed aid-b first: the finish from there.
    etaFinishPlanIso: "2026-08-15T16:00:00.000Z",
    etaFinishWindow: { earliestIso: "2026-08-15T15:30:00.000Z", latestIso: "2026-08-15T16:30:00.000Z" },
    checkpointSplits: [split("aid-b", 20_000), split("finish", 30_000)]
  } as RaceRoomProjection;

  const preRace = teaserProjection(bootstrap, withStops, { preRace: true });
  // The plan curve to the course length (18 000 s) plus five 60 s stops, from the race start.
  assert.equal(preRace.etaFinishPlanIso, "2026-08-15T18:05:00.000Z");
  assert.equal(Object.hasOwn(preRace, "etaFinishWindow"), false, "the window is centred on the same origin");
  assert.deepEqual(preRace.checkpointSplits, []);

  // Without a usable plan curve: planned pace over the course from when the projection was taken.
  const noCurve: RaceRoom = { ...withStops, course: { checkpoints: withStops.course!.checkpoints } };
  assert.equal(teaserProjection(bootstrap, noCurve, { preRace: true }).etaFinishPlanIso, "2026-08-01T03:05:00.000Z");
  // Never earlier than the projection was taken.
  const late = { ...bootstrap, asOfRecordedAt: "2026-09-01T00:00:00.000Z" };
  assert.equal(teaserProjection(late, withStops, { preRace: true }).etaFinishPlanIso, "2026-09-01T00:00:00.000Z");

  // After the runner's own pings, the finish from where they are stays.
  const live = teaserProjection(bootstrap, withStops);
  assert.equal(live.etaFinishPlanIso, bootstrap.etaFinishPlanIso);
  assert.deepEqual(live.etaFinishWindow, bootstrap.etaFinishWindow);
});

test("schedule teaser keeps the start and finish stops only", () => {
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
  assert.deepEqual(shaped.stops.map((stop) => stop.checkpointId), ["start", "finish"]);
  assert.deepEqual(shaped.locked, { checkpointIds: MID_COURSE });
  assert.equal(shaped.pacingEstimateId, "est-1");
  assert.equal(sheet.stops.length, 5, "input is not mutated");
});

test("estimate teaser keeps the finish and bands and no aid ETA, without touching the input", () => {
  const plan = estimate(MID_COURSE);
  const before = structuredClone(plan);
  const shaped = finishOnlyEstimate(plan);
  assert.deepEqual(shaped.aidEtas, []);
  assert.equal(shaped.id, plan.id);
  assert.equal(shaped.expectedFinishAt, plan.expectedFinishAt);
  assert.equal(shaped.expectedFinishElapsedSeconds, plan.expectedFinishElapsedSeconds);
  assert.deepEqual(shaped.bands, plan.bands);
  assert.deepEqual(plan, before, "input is not mutated");
});

test("room teaser drops the plan curve and every aid ETA, and leaves the cached room alone", () => {
  const original: RaceRoom = { ...room(COURSE), pacingEstimateId: "est-1", pacingEstimate: estimate(MID_COURSE) };
  const before = structuredClone(original);
  const shaped = teaserRoom(original);
  assert.equal(shaped.course?.baselineTrack, undefined);
  assert.deepEqual(shaped.course?.checkpoints, COURSE, "the checkpoint list stays for the map");
  assert.deepEqual(shaped.pacingEstimate?.aidEtas, []);
  assert.equal(shaped.pacingEstimateId, "est-1");
  assert.equal(shaped.pacingEstimate?.expectedFinishAt, original.pacingEstimate!.expectedFinishAt);
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

test("roomForViewer: paid and expired rooms go out whole; unpaid is the teaser for the runner, locked for others", () => {
  const withPlan = (status: RaceRoom["entitlement"]["status"]): RaceRoom => ({
    ...room(COURSE, status),
    pacingEstimateId: "est-1",
    pacingEstimate: estimate(MID_COURSE)
  });
  const paid = withPlan("paid");
  assert.equal(roomForViewer(paid, "crew"), paid);
  const expired = withPlan("expired");
  assert.equal(roomForViewer(expired, "runner"), expired);

  const unpaid = withPlan("unpaid");
  const before = structuredClone(unpaid);
  assert.deepEqual(roomForViewer(unpaid, "runner"), teaserRoom(unpaid));
  assert.deepEqual(roomForViewer(unpaid, "runner").pacingEstimate?.aidEtas, []);

  for (const viewer of ["crew", undefined]) {
    const locked = roomForViewer(unpaid, viewer);
    assert.deepEqual(locked, lockedRoom(unpaid));
    assert.equal(locked.pacingEstimate, undefined);
    assert.equal(locked.pacingEstimateId, undefined);
    assert.equal(locked.course?.baselineTrack, undefined);
    assert.deepEqual(locked.course?.checkpoints, COURSE, "the map still draws");
    assert.deepEqual(locked.memberships, unpaid.memberships);
    assert.deepEqual(locked.entitlement, unpaid.entitlement);
  }
  assert.deepEqual(unpaid, before, "input is not mutated");
});

test("runner seat is who you are, not the role you hold or are given", () => {
  const base: RaceRoom = {
    ...room(COURSE),
    createdByUserId: "manager",
    memberships: [{ userId: "manager", role: "team_manager", joinedAt: "2026-08-01T00:00:00.000Z" }]
  };
  assert.equal(isRunnerSeat(base, "runner"), true, "the race athlete");
  assert.equal(isRunnerSeat(base, "manager"), true, "the creator");
  assert.equal(isRunnerSeat(base, "someone-else"), false, "an athlete-role invitee is still not the runner");
});

test("export: whole only when tied to a paid race of the caller's, finish-only otherwise", () => {
  const ids = (shown: PacingEstimate) => shown.aidEtas.map((eta) => eta.checkpointId);
  const computed = estimate(MID_COURSE, "est-computed");
  const attached = estimate(MID_COURSE, "est-attached");
  const unpaid: RaceRoom = { ...room(COURSE, "unpaid"), id: "room-unpaid", pacingEstimateId: attached.id, pacingEstimate: attached };
  const paid: RaceRoom = { ...room(COURSE, "paid"), id: "room-paid", pacingEstimateId: attached.id, pacingEstimate: attached };
  const expired: RaceRoom = { ...room(COURSE, "expired"), id: "room-expired" };

  // Tied to an unpaid race, or to no race: finish only.
  assert.deepEqual(ids(exportedEstimate({ estimate: computed, roomId: unpaid.id }, [unpaid])), []);
  assert.deepEqual(ids(exportedEstimate({ estimate: attached, roomId: unpaid.id }, [unpaid])), []);
  assert.deepEqual(ids(exportedEstimate({ estimate: computed }, [unpaid, paid])), []);
  assert.deepEqual(ids(exportedEstimate({ estimate: computed, roomId: expired.id }, [expired])), []);
  // A paid race the caller is not in (not listed) unlocks nothing.
  assert.deepEqual(ids(exportedEstimate({ estimate: computed, roomId: paid.id }, [unpaid])), []);

  // Computed for or attached to a paid race, or its plan of record: whole.
  assert.deepEqual(ids(exportedEstimate({ estimate: computed, roomId: paid.id }, [unpaid, paid])), MID_COURSE);
  assert.deepEqual(ids(exportedEstimate({ estimate: attached }, [paid])), MID_COURSE);
  assert.deepEqual(ids(exportedEstimate({ estimate: attached, roomId: unpaid.id }, [unpaid, paid])), MID_COURSE);
  assert.equal(exportedEstimate({ estimate: computed, roomId: paid.id }, [paid]), computed);
});
