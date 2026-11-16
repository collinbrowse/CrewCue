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
  carryTeaserPin,
  exportedEstimate,
  isTeaserRoom,
  lockedRoom,
  pickTeaserCheckpoint,
  roomForViewer,
  teaserCheckpointsOf,
  teaserEstimate,
  teaserPinOf,
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

function estimate(aidIds: string[]): PacingEstimate {
  return {
    id: "est-1",
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

test("untagged course: the first aid station is the first mid-course stop the estimate prices", () => {
  // A GPX import: stops named "Aid 1", "Aid 2" with no tags. The estimator still gives them ETAs.
  const untagged = [cp("start", 0), cp("Aid 1", 10_000), cp("Aid 2", 20_000), cp("finish", 30_000)];
  const plan = estimate(["Aid 1", "Aid 2"]);
  const withPlan = { ...room(untagged), pacingEstimate: plan };
  const picked = teaserCheckpointsOf(withPlan);
  assert.equal(picked.firstAidCheckpointId, "Aid 1");
  assert.deepEqual(picked.lockedCheckpointIds, ["Aid 2"]);
  assert.deepEqual(teaserRoom(withPlan).pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), ["Aid 1"]);

  // A tag still wins over the estimate's order.
  const tagged = [cp("start", 0), cp("Aid 1", 10_000), cp("Aid 2", 20_000, ["aid"]), cp("finish", 30_000)];
  assert.equal(teaserCheckpointsOf({ ...room(tagged), pacingEstimate: plan }).firstAidCheckpointId, "Aid 2");

  // An ETA on the start or finish never counts as the first aid station.
  assert.equal(teaserCheckpointsOf({ ...room(untagged), pacingEstimate: estimate(["start", "finish"]) }).firstAidCheckpointId, undefined);
});

test("estimate teaser keeps the finish and the first aid ETA, without touching the input", () => {
  const plan = estimate(["water-1", "aid-a", "aid-b"]);
  const before = structuredClone(plan);
  const shaped = teaserEstimate(plan, room(COURSE));
  assert.deepEqual(shaped.aidEtas.map((eta) => eta.checkpointId), ["aid-a"]);
  assert.equal(shaped.id, plan.id);
  assert.equal(shaped.expectedFinishAt, plan.expectedFinishAt);
  assert.deepEqual(shaped.bands, plan.bands);
  assert.deepEqual(plan, before, "input is not mutated");
});

test("roomForViewer: paid and expired rooms go out whole; unpaid is the teaser for the runner, locked for others", () => {
  const withPlan = (status: RaceRoom["entitlement"]["status"]): RaceRoom => ({
    ...room(COURSE, status),
    pacingEstimateId: "est-1",
    pacingEstimate: estimate(["water-1", "aid-a", "aid-b"])
  });
  const paid = withPlan("paid");
  assert.equal(roomForViewer(paid, "crew"), paid);
  const expired = withPlan("expired");
  assert.equal(roomForViewer(expired, "runner"), expired);

  const unpaid = withPlan("unpaid");
  const before = structuredClone(unpaid);
  assert.deepEqual(roomForViewer(unpaid, "runner"), teaserRoom(unpaid));

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

/** COURSE with a plan attached that prices every mid-course stop, as a room write would store it. */
function plannedRoom(checkpoints: RaceCourseCheckpoint[] = COURSE, status: RaceRoom["entitlement"]["status"] = "unpaid"): RaceRoom {
  const plan = estimate(["water-1", "aid-a", "aid-b"]);
  const before: RaceRoom = room(checkpoints, status);
  return carryTeaserPin(before, { ...before, pacingEstimateId: plan.id, pacingEstimate: plan });
}

function withCourse(base: RaceRoom, checkpoints: RaceCourseCheckpoint[]): RaceRoom {
  return carryTeaserPin(base, { ...base, course: { ...base.course!, checkpoints } });
}

const shownAid = (subject: RaceRoom) => teaserRoom(subject).pacingEstimate?.aidEtas.map((eta) => eta.checkpointId);

test("pick: the first priced mid-course stop, preferring an aid tag; an unpriced aid tag does not count", () => {
  const plan = estimate(["water-1", "aid-b"]);
  // aid-a is tagged but unpriced, so the first tagged priced stop wins.
  assert.deepEqual(pickTeaserCheckpoint(COURSE, plan), { checkpointId: "aid-b", distanceMetersFromStart: 20_000 });
  assert.deepEqual(pickTeaserCheckpoint(COURSE, estimate(["water-1"])), {
    checkpointId: "water-1",
    distanceMetersFromStart: 5_000
  });
  assert.deepEqual(pickTeaserCheckpoint(COURSE, estimate([])), {});
  assert.deepEqual(pickTeaserCheckpoint(COURSE, undefined), { checkpointId: "aid-a", distanceMetersFromStart: 10_000 });
});

test("pin: attaching a plan pins its teaser stop on the room, and the pin never goes out", () => {
  const pinned = plannedRoom();
  assert.deepEqual(pinned.teaserCheckpoint, { pacingEstimateId: "est-1", checkpointId: "aid-a", distanceMetersFromStart: 10_000 });
  assert.equal(Object.hasOwn(roomForViewer(pinned, "runner"), "teaserCheckpoint"), false);
  assert.equal(Object.hasOwn(roomForViewer(pinned, "crew"), "teaserCheckpoint"), false);
  const paid = { ...pinned, entitlement: { ...pinned.entitlement, status: "paid" as const } };
  const { teaserCheckpoint: _pin, ...paidWithoutPin } = paid;
  assert.deepEqual(roomForViewer(paid, "runner"), paidWithoutPin, "a paid room goes out whole but for the pin");
});

test("pin: re-tagging the course cannot move the teaser to another stop", () => {
  let subject = plannedRoom();
  const retags: Array<Record<string, RaceCourseCheckpoint["tags"]>> = [
    { "water-1": ["aid"], "aid-a": ["water"], "aid-b": ["water"] },
    { "water-1": ["water"], "aid-a": ["water"], "aid-b": ["aid"] },
    { "water-1": [], "aid-a": [], "aid-b": [] }
  ];
  for (const tags of retags) {
    subject = withCourse(subject, COURSE.map((checkpoint) => ({ ...checkpoint, tags: tags[checkpoint.id] ?? checkpoint.tags })));
    assert.equal(teaserCheckpointsOf(subject).firstAidCheckpointId, "aid-a");
    assert.deepEqual(shownAid(subject), ["aid-a"]);
  }
});

test("pin: a deleted or moved pinned stop shows no aid ETA, and stays spent until a new plan", () => {
  const deleted = withCourse(plannedRoom(), COURSE.filter((checkpoint) => checkpoint.id !== "aid-a"));
  assert.equal(teaserCheckpointsOf(deleted).firstAidCheckpointId, undefined);
  assert.deepEqual(shownAid(deleted), []);
  assert.deepEqual(teaserCheckpointsOf(deleted).lockedCheckpointIds, ["water-1", "aid-b"]);
  // Putting it back does not bring the ETA back: the plan's pin is spent.
  const restored = withCourse(deleted, COURSE);
  assert.deepEqual(shownAid(restored), []);

  // Same id, moved onto aid-b's spot: the plan curve there is aid-b's ETA, so nothing shows.
  const moved = withCourse(
    plannedRoom(),
    COURSE.map((checkpoint) => (checkpoint.id === "aid-a" ? { ...checkpoint, distanceMetersFromStart: 19_990 } : checkpoint))
  );
  assert.equal(teaserCheckpointsOf(moved).firstAidCheckpointId, undefined);
  assert.deepEqual(shownAid(moved), []);
  // A nudge within the tolerance is still the same stop.
  const nudged = withCourse(
    plannedRoom(),
    COURSE.map((checkpoint) => (checkpoint.id === "aid-a" ? { ...checkpoint, distanceMetersFromStart: 10_010 } : checkpoint))
  );
  assert.deepEqual(shownAid(nudged), ["aid-a"]);

  // A new plan picks again on the course it is attached to.
  const replan = { ...estimate(["water-1", "aid-b"]), id: "est-2" };
  const replanned = carryTeaserPin(deleted, { ...deleted, pacingEstimateId: replan.id, pacingEstimate: replan });
  assert.deepEqual(replanned.teaserCheckpoint, { pacingEstimateId: "est-2", checkpointId: "aid-b", distanceMetersFromStart: 20_000 });
  assert.deepEqual(shownAid(replanned), ["aid-b"]);
});

test("pin: a pick recorded when the plan was computed is kept on attach; dropping the plan drops the pin", () => {
  const base = room(COURSE);
  const plan = estimate(["water-1", "aid-a", "aid-b"]);
  const recorded = { pacingEstimateId: plan.id, checkpointId: "water-1", distanceMetersFromStart: 5_000 };
  const attached = carryTeaserPin(base, { ...base, pacingEstimateId: plan.id, pacingEstimate: plan, teaserCheckpoint: recorded });
  assert.deepEqual(attached.teaserCheckpoint, recorded);
  assert.deepEqual(shownAid(attached), ["water-1"]);
  // A later write cannot swap it for another pick.
  const rewritten = carryTeaserPin(attached, { ...attached, teaserCheckpoint: { ...recorded, checkpointId: "aid-b" } });
  assert.deepEqual(rewritten.teaserCheckpoint, recorded);

  const { pacingEstimate: _plan, pacingEstimateId: _id, ...withoutPlan } = attached;
  assert.equal(Object.hasOwn(carryTeaserPin(attached, withoutPlan), "teaserCheckpoint"), false);
});

test("pin: a plan attached before pins existed is pinned from the course before the first write", () => {
  const plan = estimate(["water-1", "aid-a", "aid-b"]);
  const legacy: RaceRoom = { ...room(COURSE), pacingEstimateId: plan.id, pacingEstimate: plan };
  assert.equal(teaserPinOf(legacy)?.checkpointId, "aid-a");
  const retagged = withCourse(
    legacy,
    COURSE.map((checkpoint) => ({ ...checkpoint, tags: checkpoint.id === "aid-b" ? ["aid"] : [] }))
  );
  assert.equal(retagged.teaserCheckpoint?.checkpointId, "aid-a");
  assert.deepEqual(shownAid(retagged), ["aid-a"]);
});

test("export: an unpaid race's estimates as the race showed them; paid races and room-less snapshots in full", () => {
  const pinned = plannedRoom();
  const attachedPlan = pinned.pacingEstimate!;
  const ids = (shown: PacingEstimate) => shown.aidEtas.map((eta) => eta.checkpointId);
  assert.deepEqual(ids(exportedEstimate({ estimate: attachedPlan }, pinned)), ["aid-a"]);
  const other = { ...estimate(["water-1", "aid-a", "aid-b"]), id: "est-other" };
  assert.deepEqual(ids(exportedEstimate({ estimate: other, teaser: { checkpointId: "water-1" } }, pinned)), ["water-1"]);
  assert.deepEqual(ids(exportedEstimate({ estimate: other }, pinned)), ["aid-a"]);
  assert.deepEqual(ids(exportedEstimate({ estimate: other, teaser: {} }, undefined)), []);
  assert.deepEqual(ids(exportedEstimate({ estimate: other }, undefined)), ["water-1", "aid-a", "aid-b"]);
  const paid = { ...pinned, entitlement: { ...pinned.entitlement, status: "paid" as const } };
  assert.deepEqual(ids(exportedEstimate({ estimate: attachedPlan, teaser: { checkpointId: "aid-a" } }, paid)), [
    "water-1",
    "aid-a",
    "aid-b"
  ]);
});
