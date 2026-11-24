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
import { geodesicPolylineLength } from "@crewcue/map-core";
import { isRunnerSeat, roomUnpaidError } from "./billingEntitlement.js";
import {
  attachBlockedBy,
  courseLengthOf,
  courseLengthsMatch,
  estimateCourseLengthMeters,
  exportedEstimate,
  finishOnlyEstimate,
  isTeaserRoom,
  lockedRoom,
  projectionForRoom,
  roomForViewer,
  teaserCheckpointsOf,
  teaserProjection,
  teaserRoom,
  teaserScheduleRoom,
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

/** A 30 km route along the equator (no stored length on `room()`). */
const ROUTE = [
  { latitude: 0, longitude: 0, elevationMeters: null },
  { latitude: 0, longitude: 0.1349, elevationMeters: null },
  { latitude: 0, longitude: 0.2698, elevationMeters: null }
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
    asOfPingId: "ping-1",
    asOfRecordedAt: "2026-08-01T00:00:00.000Z",
    progressMeters: 0,
    plannedPaceSecondsPerKm: 360,
    etaFinishPlanIso: "2026-08-15T21:20:00.000Z",
    courseLengthMeters: 30_000,
    checkpointSplits: COURSE.map((checkpoint) => split(checkpoint.id, checkpoint.distanceMetersFromStart!)),
    remainingCheckpointEtas: ["aid-a", "aid-b", "finish"].map((checkpointId) => ({
      checkpointId,
      liveProjectedElapsedSeconds: 1,
      frozenPlanElapsedSeconds: 1,
      deltaSecondsVsFrozenPlan: 0
    }))
  } as RaceRoomProjection;
  const started = { ...room(COURSE), raceStartAt: "2026-08-15T13:00:00.000Z" };
  const shaped = teaserProjection(projection, started);
  assert.deepEqual(shaped.checkpointSplits, []);
  assert.deepEqual(shaped.remainingCheckpointEtas, []);
  // The plan curve to the course length (18 000 s) from the race start.
  assert.equal(shaped.etaFinishPlanIso, "2026-08-15T18:00:00.000Z");
  assert.equal(shaped.courseLengthMeters, 30_000);
  assert.equal(shaped.progressMeters, 0);
  assert.deepEqual(shaped.locked, { checkpointIds: MID_COURSE });
  assert.equal(projection.checkpointSplits.length, 5, "input is not mutated");
  assert.equal(projection.etaFinishPlanIso, "2026-08-15T21:20:00.000Z", "input is not mutated");

  const { remainingCheckpointEtas: _absent, ...withoutRemaining } = projection;
  const noRemaining = teaserProjection(withoutRemaining as RaceRoomProjection, started);
  assert.equal(noRemaining.remainingCheckpointEtas, undefined);
  assert.deepEqual(noRemaining.locked, { checkpointIds: MID_COURSE });
});

test("projection teaser: the finish from the start line, whatever checkpoint is listed first or the runner pings from", () => {
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

  const shaped = teaserProjection(bootstrap, withStops);
  // The plan curve to the course length (18 000 s) plus the 60 s stops before the finish (four:
  // the finish's own stop is after the finish line), from the race start.
  assert.equal(shaped.etaFinishPlanIso, "2026-08-15T18:04:00.000Z");
  assert.equal(Object.hasOwn(shaped, "etaFinishWindow"), false, "the window is centred on the same origin");
  assert.deepEqual(shaped.checkpointSplits, []);

  // A live projection from a ping at aid-b (the runner chooses where they ping from): the finish
  // from there would be the finish minus aid-b's ETA. The teaser's finish does not move.
  const fromPing = {
    ...bootstrap,
    asOfPingId: "ping-at-aid-b",
    asOfRecordedAt: "2026-08-15T14:00:00.000Z",
    etaFinishPlanIso: "2026-08-15T17:00:00.000Z"
  } as RaceRoomProjection;
  const live = teaserProjection(fromPing, withStops);
  assert.equal(live.etaFinishPlanIso, "2026-08-15T18:04:00.000Z");
  assert.equal(Object.hasOwn(live, "etaFinishWindow"), false);
  assert.equal(teaserProjection({ ...fromPing, progressMeters: 10_000 }, withStops).etaFinishPlanIso, live.etaFinishPlanIso);

  // Without a usable plan curve: planned pace over the course (10 800 s) plus the stops before the
  // finish, from the race start when the projection was taken before it (the pre-race bootstrap)...
  const noCurve: RaceRoom = { ...withStops, course: { checkpoints: withStops.course!.checkpoints } };
  assert.equal(teaserProjection(bootstrap, noCurve).etaFinishPlanIso, "2026-08-15T16:04:00.000Z");
  // ...and from when it was taken, after the start.
  assert.equal(teaserProjection(fromPing, noCurve).etaFinishPlanIso, "2026-08-15T17:04:00.000Z");
  // Never earlier than the projection was taken.
  const late = { ...bootstrap, asOfRecordedAt: "2026-09-01T00:00:00.000Z" };
  assert.equal(teaserProjection(late, withStops).etaFinishPlanIso, "2026-09-01T00:00:00.000Z");
});

test("ping replies: an unpaid race's projection is the teaser, a paid race's goes out as is", () => {
  const projection = {
    roomId: "room-1",
    asOfPingId: "ping-1",
    asOfRecordedAt: "2026-08-15T14:00:00.000Z",
    progressMeters: 12_000,
    courseLengthMeters: 30_000,
    plannedPaceSecondsPerKm: 360,
    // The finish from the ping at 12 km.
    etaFinishPlanIso: "2026-08-15T17:10:00.000Z",
    etaFinishWindow: { earliestIso: "2026-08-15T16:40:00.000Z", latestIso: "2026-08-15T17:40:00.000Z" },
    checkpointSplits: COURSE.map((checkpoint) => split(checkpoint.id, checkpoint.distanceMetersFromStart!)),
    remainingCheckpointEtas: [{ checkpointId: "aid-b", liveProjectedElapsedSeconds: 1, frozenPlanElapsedSeconds: 1, deltaSecondsVsFrozenPlan: 0 }]
  } as RaceRoomProjection;
  const unpaid = { ...room(COURSE, "unpaid"), raceStartAt: "2026-08-15T13:00:00.000Z" };
  assert.deepEqual(projectionForRoom(projection, unpaid), teaserProjection(projection, unpaid));
  assert.deepEqual(projectionForRoom(projection, unpaid).checkpointSplits, []);
  assert.deepEqual(projectionForRoom(projection, unpaid).remainingCheckpointEtas, []);
  // Accepted pings or not, the finish is the one from the start line, with no window.
  assert.equal(projectionForRoom(projection, unpaid).etaFinishPlanIso, "2026-08-15T18:00:00.000Z");
  assert.equal(Object.hasOwn(projectionForRoom(projection, unpaid), "etaFinishWindow"), false);
  const paid = room(COURSE, "paid");
  assert.equal(projectionForRoom(projection, paid), projection);
  assert.equal(projectionForRoom(projection, room(COURSE, "expired")), projection);
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
  const shaped = teaserScheduleSheet(sheet, room(COURSE), 30_000);
  assert.deepEqual(shaped.stops.map((stop) => stop.checkpointId), ["start", "finish"]);
  assert.deepEqual(shaped.locked, { checkpointIds: MID_COURSE });
  assert.equal(shaped.pacingEstimateId, "est-1");
  assert.equal(sheet.stops.length, 5, "input is not mutated");
});

test("schedule teaser on a course with no finish waypoint: the route-end finish row is the finish, the last aid is locked", () => {
  // The checkpoints stop at aid-b, 10 km short of the 30 km route's end.
  const noFinish = COURSE.filter((checkpoint) => checkpoint.id !== "finish");
  const rows = [...noFinish.map((checkpoint) => checkpoint.id), "finish"];
  const sheet: CrewScheduleSheet = {
    roomId: "room-1",
    raceStartAt: "2026-08-15T13:00:00.000Z",
    stops: rows.map((checkpointId, index) => ({
      id: `stop-${checkpointId}`,
      checkpointId,
      clockArrivalAt: "2026-08-15T13:00:00.000Z",
      elapsedSeconds: index * 1000,
      plannedStoppageSeconds: 0
    }))
  };
  const shaped = teaserScheduleSheet(sheet, room(noFinish), 30_000);
  assert.deepEqual(shaped.stops.map((stop) => stop.checkpointId), ["start", "finish"]);
  assert.deepEqual(shaped.locked, { checkpointIds: MID_COURSE });
  assert.deepEqual(teaserCheckpointsOf(room(noFinish)).lockedCheckpointIds, ["water-1", "aid-a"], "without a length, the last row is the finish");
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

/** A stored estimate's provenance, as rows written from now on carry it. */
function stored(plan: PacingEstimate, roomIds: string[] = []) {
  return { estimate: plan, roomIds, legacyProvenance: false };
}

/** A row stored before provenance was tracked (`roomIds` holds a #724 row's single room, if any). */
function legacy(plan: PacingEstimate, roomIds: string[] = []) {
  return { estimate: plan, roomIds, legacyProvenance: true };
}

test("export: whole only when tied to a paid race of the caller's, finish-only otherwise", () => {
  const ids = (shown: PacingEstimate) => shown.aidEtas.map((eta) => eta.checkpointId);
  const computed = estimate(MID_COURSE, "est-computed");
  const attached = estimate(MID_COURSE, "est-attached");
  const unpaid: RaceRoom = { ...room(COURSE, "unpaid"), id: "room-unpaid", pacingEstimateId: attached.id, pacingEstimate: attached };
  const paid: RaceRoom = { ...room(COURSE, "paid"), id: "room-paid", pacingEstimateId: attached.id, pacingEstimate: attached };
  const expired: RaceRoom = { ...room(COURSE, "expired"), id: "room-expired" };

  // Tied to an unpaid race, or to no race: finish only.
  assert.deepEqual(ids(exportedEstimate(stored(computed, [unpaid.id]), [unpaid])), []);
  assert.deepEqual(ids(exportedEstimate(stored(attached, [unpaid.id]), [unpaid])), []);
  assert.deepEqual(ids(exportedEstimate(stored(computed), [unpaid, paid])), []);
  assert.deepEqual(ids(exportedEstimate(stored(computed, [expired.id]), [expired])), []);
  // A paid race the caller is not in (not listed) unlocks nothing.
  assert.deepEqual(ids(exportedEstimate(stored(computed, [paid.id]), [unpaid])), []);

  // Computed for or attached to a paid race, or its plan of record: whole.
  assert.deepEqual(ids(exportedEstimate(stored(computed, [paid.id]), [unpaid, paid])), MID_COURSE);
  assert.deepEqual(ids(exportedEstimate(stored(attached), [paid])), MID_COURSE);
  assert.deepEqual(ids(exportedEstimate(stored(attached, [unpaid.id]), [unpaid, paid])), MID_COURSE);
  assert.equal(exportedEstimate(stored(computed, [paid.id]), [paid]), computed);
  // One id serving an unpaid and a paid race of the caller's: the paid one unlocks it.
  assert.deepEqual(ids(exportedEstimate(stored(computed, [paid.id, unpaid.id]), [unpaid, paid])), MID_COURSE);
});

test("export: a legacy row goes out whole while the caller has no unpaid race, else by the same rule", () => {
  const ids = (shown: PacingEstimate) => shown.aidEtas.map((eta) => eta.checkpointId);
  const plan = estimate(MID_COURSE, "est-legacy");
  const paid: RaceRoom = { ...room(COURSE, "paid"), id: "room-paid" };
  const expired: RaceRoom = { ...room(COURSE, "expired"), id: "room-expired" };
  const unpaid: RaceRoom = { ...room(COURSE, "unpaid"), id: "room-unpaid" };

  // Paying users (and accounts with no race) keep what they had before the teaser.
  assert.equal(exportedEstimate(legacy(plan), []), plan);
  assert.equal(exportedEstimate(legacy(plan), [paid, expired]), plan);
  assert.deepEqual(ids(exportedEstimate(legacy(plan, [unpaid.id]), [paid])), MID_COURSE, "a #724 row whose race is gone");
  // With an unpaid race, a legacy row could be its plan: whole only when a paid race ties it.
  assert.deepEqual(ids(exportedEstimate(legacy(plan), [paid, unpaid])), []);
  assert.deepEqual(ids(exportedEstimate(legacy(plan, [unpaid.id]), [unpaid])), []);
  assert.deepEqual(ids(exportedEstimate(legacy(plan, [paid.id]), [paid, unpaid])), MID_COURSE);
  const planOfRecord: RaceRoom = { ...paid, pacingEstimateId: plan.id, pacingEstimate: plan };
  assert.deepEqual(ids(exportedEstimate(legacy(plan), [planOfRecord, unpaid])), MID_COURSE);
  // Rows written from now on never take the legacy rule.
  assert.deepEqual(ids(exportedEstimate(stored(plan), [paid])), []);
});

test("attachBlockedBy: refused only by another race that is unpaid, with no paid race of the caller's or the target", () => {
  const plan = estimate(MID_COURSE, "est-shared");
  const withMember = (base: RaceRoom, id: string, member = "runner"): RaceRoom => ({
    ...base,
    id,
    memberships: [{ userId: member, role: "athlete", joinedAt: "2026-08-01T00:00:00.000Z" }]
  });
  const unpaidA = withMember(room(COURSE, "unpaid"), "room-a");
  const paidB = withMember(room(COURSE, "paid"), "room-b");
  const paidElsewhere = { ...withMember(room(COURSE, "paid"), "room-other", "someone-else"), athleteId: "someone-else" };
  const target = withMember(room(COURSE, "paid"), "room-target");
  const unpaidTarget = withMember(room(COURSE, "unpaid"), "room-target");
  const blocked = (roomIds: string[], to: RaceRoom, rooms: RaceRoom[], caller = "runner") =>
    attachBlockedBy(stored(plan, roomIds), to, caller, rooms)?.id;

  // Computed for unpaid A only: no paid race may take it, nor another unpaid one.
  assert.equal(blocked([unpaidA.id], target, [unpaidA]), unpaidA.id);
  assert.equal(blocked([unpaidA.id], unpaidTarget, [unpaidA]), unpaidA.id);
  // The same estimate computed for paid B too (its id follows the inputs): B unlocks it.
  assert.equal(blocked([unpaidA.id, paidB.id], paidB, [unpaidA, paidB]), undefined, "B is in the set");
  assert.equal(blocked([unpaidA.id, paidB.id], target, [unpaidA, paidB]), undefined, "a paid race of the caller's");
  // A paid race the caller is not in unlocks nothing.
  assert.equal(blocked([unpaidA.id, paidElsewhere.id], target, [unpaidA, paidElsewhere]), unpaidA.id);
  // The target in the set, or already its plan of record.
  assert.equal(blocked([unpaidA.id, target.id], target, [unpaidA]), undefined);
  const attachedTarget = { ...target, pacingEstimateId: plan.id, pacingEstimate: plan };
  assert.equal(blocked([unpaidA.id], attachedTarget, [unpaidA]), undefined);
  // No unpaid race named (none, paid only, or deleted): allowed.
  assert.equal(blocked([], target, []), undefined);
  assert.equal(blocked([paidElsewhere.id], target, [paidElsewhere]), undefined);
  assert.equal(blocked([unpaidA.id], target, []), undefined, "the unpaid race is gone");
  // Once A is paid it moves freely.
  assert.equal(blocked([unpaidA.id], target, [{ ...unpaidA, entitlement: paidB.entitlement }]), undefined);
});

test("course length: an estimate fits within 1% or 100 m of the course, whichever is larger", () => {
  assert.equal(courseLengthsMatch(50_000, 50_000), true);
  assert.equal(courseLengthsMatch(50_490, 50_000), true, "1% of 50 km is 500 m");
  assert.equal(courseLengthsMatch(49_500, 50_000), true);
  assert.equal(courseLengthsMatch(50_510, 50_000), false);
  assert.equal(courseLengthsMatch(49_490, 50_000), false);
  assert.equal(courseLengthsMatch(5_099, 5_000), true, "100 m beats 1% of 5 km");
  assert.equal(courseLengthsMatch(4_890, 5_000), false);
  assert.equal(courseLengthsMatch(13_000, 50_000), false, "a course cut at an aid station");
  assert.equal(courseLengthsMatch(undefined, 50_000), false, "an unknown length never fits");
  assert.equal(courseLengthsMatch(50_000, undefined), false);

  // Recorded when computed; a legacy row falls back to where its plan curve ends.
  const curve = { points: [{ distanceMetersFromStart: 0, referenceElapsedSeconds: 0 }, { distanceMetersFromStart: 30_000, referenceElapsedSeconds: 18_000 }] };
  assert.equal(estimateCourseLengthMeters({ courseLengthMeters: 29_000, baselineTrack: curve }), 29_000);
  assert.equal(estimateCourseLengthMeters({ baselineTrack: curve }), 30_000);
  assert.equal(estimateCourseLengthMeters({}), undefined);

  // The race's: canonical distance, else the room's, else its route's (below).
  const base = room(COURSE);
  assert.equal(courseLengthOf({ ...base, courseDistanceMeters: 31_000 }, ROUTE), 31_000);
  assert.equal(
    courseLengthOf(
      {
        ...base,
        courseDistanceMeters: 31_000,
        course: {
          ...base.course!,
          derivedMetrics: {
            canonicalDistanceMeters: 32_000,
            elevationGainMeters: 0,
            elevationLossMeters: 0,
            elevationSource: "none",
            metricsVersion: 1
          }
        }
      },
      ROUTE
    ),
    32_000
  );
  assert.equal(courseLengthOf({ ...base, course: undefined }, null), undefined);
});

test("course length: with no stored length it is the route's, never the farthest checkpoint's", () => {
  const routeMeters = geodesicPolylineLength(ROUTE);
  assert.ok(Math.abs(routeMeters - 30_000) < 100, `route ${routeMeters}`);
  // A legacy room (no canonical or room distance) whose checkpoints stop at aid-b, 20 km in: the
  // route's 30 km, not aid-b's 20 km, so a plan computed there reads its finish at the end.
  const legacy = room(COURSE.slice(0, 4));
  assert.equal(courseLengthOf(legacy, ROUTE), routeMeters);
  assert.equal(courseLengthsMatch(20_000, courseLengthOf(legacy, ROUTE)), false, "a plan priced at aid-b does not fit");
  assert.equal(courseLengthsMatch(routeMeters, courseLengthOf(legacy, ROUTE)), true);
  // No stored length and no route: unknown, so no plan fits it (attach is 400 course_mismatch).
  for (const route of [null, undefined, [], ROUTE.slice(0, 1)]) {
    assert.equal(courseLengthOf(legacy, route), undefined);
    assert.equal(courseLengthsMatch(20_000, courseLengthOf(legacy, route)), false);
  }
  // A stored length wins over the route.
  assert.equal(courseLengthOf({ ...legacy, courseDistanceMeters: 31_000 }, ROUTE), 31_000);
});

test("schedule teaser room: the plan curve collapses to the start and the finish, nothing between", () => {
  const original: RaceRoom = {
    ...room(COURSE),
    plannedPaceSecondsPerKm: 360,
    course: {
      checkpoints: COURSE,
      baselineTrack: {
        points: [
          { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
          { distanceMetersFromStart: 10_000, referenceElapsedSeconds: 9_000 },
          { distanceMetersFromStart: 30_000, referenceElapsedSeconds: 18_000 }
        ],
        planLogSigma: 0.1
      }
    }
  };
  const before = structuredClone(original);
  const shaped = teaserScheduleRoom(original, 30_000);
  assert.deepEqual(shaped.course?.baselineTrack, {
    points: [
      { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
      { distanceMetersFromStart: 30_000, referenceElapsedSeconds: 18_000 }
    ]
  });
  assert.deepEqual(shaped.course?.checkpoints, COURSE);
  assert.deepEqual(original, before, "input is not mutated");

  // A curve that ends before the course is not usable there: dropped, as `teaserRoom` does.
  assert.equal(teaserScheduleRoom(original, 40_000).course?.baselineTrack, undefined);
  // With a plan attached it is finish-only, as in `teaserRoom`.
  const withPlan = { ...original, pacingEstimateId: "est-1", pacingEstimate: estimate(MID_COURSE) };
  assert.deepEqual(teaserScheduleRoom(withPlan, 30_000).pacingEstimate?.aidEtas, []);
});

test("schedule teaser room: a finish waypoint short of the course end moves there; a course with no finish waypoint keeps its last aid where it is", () => {
  // The route runs 30 km; the finish waypoint is at 27 km (10% short), marked as the finish.
  const shortFinish = [...COURSE.slice(0, 4), cp("finish", 27_000, ["aid"])];
  const original: RaceRoom = { ...room(shortFinish), plannedPaceSecondsPerKm: 360 };
  const before = structuredClone(original);
  const shaped = teaserScheduleRoom(original, 30_000);
  assert.deepEqual(
    shaped.course?.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint.distanceMetersFromStart]),
    [
      ["start", 0],
      ["water-1", 5_000],
      ["aid-a", 10_000],
      ["aid-b", 20_000],
      ["finish", 30_000]
    ]
  );
  // The curve still collapses to the finish at the course length, so the finish row reads 18 000 s.
  assert.deepEqual(shaped.course?.baselineTrack?.points.at(-1), { distanceMetersFromStart: 30_000, referenceElapsedSeconds: 18_000 });
  assert.deepEqual(original, before, "input is not mutated");
  // A finish at the course end, or past it, stays where it is.
  assert.deepEqual(teaserScheduleRoom(room(COURSE), 30_000).course?.checkpoints, COURSE);
  // Without a usable curve the finish still moves (planned pace over the whole course).
  const noCurve = teaserScheduleRoom({ ...original, course: { checkpoints: shortFinish } }, 30_000);
  assert.equal(noCurve.course?.baselineTrack, undefined);
  assert.equal(noCurve.course?.checkpoints.at(-1)?.distanceMetersFromStart, 30_000);
  // The checkpoints stop at aid-b (20 km), with no finish waypoint: aid-b is an aid station and
  // stays at 20 km; the schedule's route-end finish row is the finish.
  const cut = COURSE.slice(0, 4);
  assert.deepEqual(teaserScheduleRoom({ ...original, course: { ...original.course!, checkpoints: cut } }, 30_000).course?.checkpoints, cut);
});
