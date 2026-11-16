/**
 * The teaser an unpaid race shows its runner during onboarding: the course, the finish ETA and
 * one aid station's ETA. Every other checkpoint ETA is withheld here, on the server, and teaser
 * reads list the withheld checkpoints in `locked`. Pure: no storage, no Fastify.
 *
 * Crew get 402 on the gated reads of an unpaid race. Routes that answer any member with a 200
 * (lists, join, accept, member edits, course and plan writes) still serialize the room, so every
 * RaceRoom a route sends goes through `roomForViewer`, and every PacingEstimate a route sends for
 * an unpaid race goes through `teaserEstimate` (or `estimateShowing` with a recorded pick).
 *
 * Which stop is shown is pinned to the attached plan (`room.teaserCheckpoint`, kept by
 * `carryTeaserPin` on every room write), so re-tagging or editing the course cannot walk the
 * teaser across the other stops. Only a new estimate picks again.
 */
import type {
  CrewScheduleSheet,
  PacingEstimate,
  RaceCourseCheckpoint,
  RaceRoom,
  RaceRoomProjection,
  RaceRoomTeaserCheckpoint
} from "@crewcue/contracts";

export function isTeaserRoom(room: RaceRoom): boolean {
  return room.entitlement.status === "unpaid";
}

/**
 * A pinned stop that has moved farther than this along the course since it was pinned is no
 * longer the stop the teaser priced, so it shows no aid ETA. Otherwise moving the pinned stop
 * would read the plan curve anywhere on the course.
 */
export const TEASER_PIN_MOVE_TOLERANCE_METERS = 25;

/** The one stop a teaser shows, and where it was when picked. Empty: none (finish only). */
export type TeaserPick = Omit<RaceRoomTeaserCheckpoint, "pacingEstimateId">;

export type TeaserCheckpoints = {
  startCheckpointId?: string;
  /** The one mid-course stop whose ETA shows (the pinned stop for the attached plan). */
  firstAidCheckpointId?: string;
  finishCheckpointId?: string;
  /** Every other course checkpoint, in course order. Their ETAs are withheld. */
  lockedCheckpointIds: string[];
};

/**
 * Course order: by distance from the start when every checkpoint has one (stable, so ties keep
 * the later row last, as the schedule does), else as listed.
 */
function courseOrder(checkpoints: readonly RaceCourseCheckpoint[]): RaceCourseCheckpoint[] {
  const measured = checkpoints.every((checkpoint) => finiteDistance(checkpoint) !== undefined);
  const ordered = [...checkpoints];
  if (measured) {
    ordered.sort((a, b) => a.distanceMetersFromStart! - b.distanceMetersFromStart!);
  }
  return ordered;
}

function finiteDistance(checkpoint: RaceCourseCheckpoint): number | undefined {
  const distance = checkpoint.distanceMetersFromStart;
  return typeof distance === "number" && Number.isFinite(distance) ? distance : undefined;
}

function courseParts(checkpoints: readonly RaceCourseCheckpoint[]) {
  const ordered = courseOrder(checkpoints);
  const start = ordered[0];
  const finish = ordered.length >= 2 ? ordered[ordered.length - 1] : undefined;
  const midCourse = ordered.filter((checkpoint) => checkpoint !== start && checkpoint !== finish);
  return { ordered, start, finish, midCourse };
}

/** Checkpoints strictly between the first and the last, in course order. */
export function midCourseCheckpointsOf(checkpoints: readonly RaceCourseCheckpoint[]): RaceCourseCheckpoint[] {
  return courseParts(checkpoints).midCourse;
}

const isAidTagged = (checkpoint: RaceCourseCheckpoint) => (checkpoint.tags ?? []).includes("aid");

function pickOf(checkpoint: RaceCourseCheckpoint | undefined): TeaserPick {
  if (!checkpoint) return {};
  const distance = finiteDistance(checkpoint);
  return { checkpointId: checkpoint.id, ...(distance !== undefined ? { distanceMetersFromStart: distance } : {}) };
}

/**
 * A fresh pick for `estimate` on `checkpoints`: the first mid-course stop by distance that the
 * estimate gives an aid ETA, preferring one tagged `aid` (a GPX import whose stops are only
 * named "Aid 1"... falls back to the first priced stop). The start and finish are never it. With
 * no estimate (a course with no plan yet, read on planned pace), the first `aid`-tagged
 * mid-course stop.
 */
export function pickTeaserCheckpoint(
  checkpoints: readonly RaceCourseCheckpoint[],
  estimate: PacingEstimate | undefined
): TeaserPick {
  const { midCourse } = courseParts(checkpoints);
  if (!estimate) {
    return pickOf(midCourse.find(isAidTagged));
  }
  const priced = new Set(estimate.aidEtas.map((eta) => eta.checkpointId));
  const candidates = midCourse.filter((checkpoint) => priced.has(checkpoint.id));
  return pickOf(candidates.find(isAidTagged) ?? candidates[0]);
}

/**
 * The pin for the room's attached plan: the stored one, else a pick on the current course (a
 * plan attached before pins existed; `carryTeaserPin` stores it on the room's next write).
 */
export function teaserPinOf(room: RaceRoom): RaceRoomTeaserCheckpoint | undefined {
  const estimate = room.pacingEstimate;
  if (!estimate) return undefined;
  if (room.teaserCheckpoint?.pacingEstimateId === estimate.id) return room.teaserCheckpoint;
  return { pacingEstimateId: estimate.id, ...pickTeaserCheckpoint(room.course?.checkpoints ?? [], estimate) };
}

/**
 * Keeps the pin with the plan it was taken for across a room write (`commitRaceRoomUpdate`
 * runs every course, plan, member and entitlement edit through here):
 * - same plan of record: the pin the room had before this write, so a tag or checkpoint edit in
 *   the write cannot move it. If the write deletes or moves the pinned stop, the pin is spent:
 *   no aid ETA (finish only) until a new estimate is attached, even if the stop comes back;
 * - a new plan: the pick the caller recorded for it (`teaserCheckpoint` for that estimate id,
 *   from when it was computed), else a fresh pick on the course it is attached to;
 * - no plan: no pin.
 */
export function carryTeaserPin(previous: RaceRoom, next: RaceRoom): RaceRoom {
  const estimate = next.pacingEstimate;
  if (!estimate) {
    if (next.teaserCheckpoint === undefined) return next;
    const { teaserCheckpoint: _dropped, ...rest } = next;
    return rest;
  }
  let pin: RaceRoomTeaserCheckpoint;
  if (previous.pacingEstimate?.id === estimate.id) {
    pin = teaserPinOf(previous)!;
    if (pin.checkpointId !== undefined && !pickedStop(courseParts(next.course?.checkpoints ?? []).midCourse, pin)) {
      pin = { pacingEstimateId: estimate.id };
    }
  } else {
    pin = teaserPinOf(next)!;
  }
  return next.teaserCheckpoint === pin ? next : { ...next, teaserCheckpoint: pin };
}

/** The stop a pick names, while it is still a mid-course stop where it was picked. */
function pickedStop(midCourse: readonly RaceCourseCheckpoint[], pick: TeaserPick | undefined) {
  if (pick?.checkpointId === undefined) return undefined;
  const stop = midCourse.find((checkpoint) => checkpoint.id === pick.checkpointId);
  if (!stop || pick.distanceMetersFromStart === undefined) return stop;
  const distance = finiteDistance(stop);
  return distance !== undefined && Math.abs(distance - pick.distanceMetersFromStart) <= TEASER_PIN_MOVE_TOLERANCE_METERS
    ? stop
    : undefined;
}

/**
 * Which checkpoints a teaser shows for `estimate` (default the room's plan of record). For the
 * attached plan that is the pinned stop; for any other estimate (one just computed, or an older
 * one in the export) a fresh pick on the current course. With no estimate, the first
 * `aid`-tagged mid-course stop.
 */
export function teaserCheckpointsOf(
  room: RaceRoom,
  estimate: PacingEstimate | undefined = room.pacingEstimate
): TeaserCheckpoints {
  const checkpoints = room.course?.checkpoints ?? [];
  const { ordered, start, finish, midCourse } = courseParts(checkpoints);
  const pick =
    estimate !== undefined && estimate.id === room.pacingEstimate?.id
      ? teaserPinOf(room)
      : pickTeaserCheckpoint(checkpoints, estimate);
  const firstAid = pickedStop(midCourse, pick);
  const visible = new Set([start?.id, firstAid?.id, finish?.id].filter((id): id is string => id !== undefined));
  const locked: string[] = [];
  for (const checkpoint of ordered) {
    if (!visible.has(checkpoint.id) && !locked.includes(checkpoint.id)) {
      locked.push(checkpoint.id);
    }
  }
  return {
    ...(start ? { startCheckpointId: start.id } : {}),
    ...(firstAid ? { firstAidCheckpointId: firstAid.id } : {}),
    ...(finish ? { finishCheckpointId: finish.id } : {}),
    lockedCheckpointIds: locked
  };
}

/** What `teaserEstimate(estimate, room)` shows, as a pick to record with the stored estimate. */
export function teaserPickShown(room: RaceRoom, estimate: PacingEstimate): TeaserPick {
  const { firstAidCheckpointId } = teaserCheckpointsOf(room, estimate);
  return pickOf(room.course?.checkpoints.find((checkpoint) => checkpoint.id === firstAidCheckpointId));
}

/**
 * Projection teaser: the finish ETA and course-level fields stay; `checkpointSplits` and
 * `remainingCheckpointEtas` keep the shown aid station only.
 */
export function teaserProjection(projection: RaceRoomProjection, room: RaceRoom): RaceRoomProjection {
  const { firstAidCheckpointId, lockedCheckpointIds } = teaserCheckpointsOf(room);
  const shown = (checkpointId: string) => firstAidCheckpointId !== undefined && checkpointId === firstAidCheckpointId;
  return {
    ...projection,
    checkpointSplits: projection.checkpointSplits.filter((row) => shown(row.checkpointId)),
    ...(projection.remainingCheckpointEtas
      ? { remainingCheckpointEtas: projection.remainingCheckpointEtas.filter((eta) => shown(eta.checkpointId)) }
      : {}),
    locked: { checkpointIds: lockedCheckpointIds }
  };
}

/**
 * Schedule teaser: the start, shown aid and finish stops; the rest are dropped. Build `sheet`
 * from `teaserEstimate(room.pacingEstimate, room)`, not the whole plan, so the start and finish
 * rows are interpolated from the shown anchors only: a course re-saved so a priced stop is its
 * first row would otherwise carry that stop's ETA as the "start".
 */
export function teaserScheduleSheet(sheet: CrewScheduleSheet, room: RaceRoom): CrewScheduleSheet {
  const { startCheckpointId, firstAidCheckpointId, finishCheckpointId, lockedCheckpointIds } = teaserCheckpointsOf(room);
  const shown = new Set(
    [startCheckpointId, firstAidCheckpointId, finishCheckpointId].filter((id): id is string => id !== undefined)
  );
  return {
    ...sheet,
    stops: sheet.stops.filter((stop) => shown.has(stop.checkpointId)),
    locked: { checkpointIds: lockedCheckpointIds }
  };
}

/** `estimate` with the finish (expected time, bands) and at most `checkpointId`'s aid ETA. */
export function estimateShowing(estimate: PacingEstimate, checkpointId: string | undefined): PacingEstimate {
  return {
    ...estimate,
    aidEtas: estimate.aidEtas.filter((eta) => checkpointId !== undefined && eta.checkpointId === checkpointId)
  };
}

/**
 * Estimate teaser: the finish (expected time, bands) and the shown aid station's ETA. Used for
 * the attached plan in a teaser room and for every estimate a route returns on an unpaid race.
 * The stored estimate stays whole, so paying unlocks it without a recompute.
 */
export function teaserEstimate(estimate: PacingEstimate, room: RaceRoom): PacingEstimate {
  return estimateShowing(estimate, teaserCheckpointsOf(room, estimate).firstAidCheckpointId);
}

/**
 * A stored estimate as `GET /me/export` returns it: what the runner was shown. In full for a
 * paid (or expired) race and for an estimate no race shaped; for an unpaid race, as the room
 * shows it (its attached plan) or as it was answered when computed (`teaser`).
 */
export function exportedEstimate(
  stored: { estimate: PacingEstimate; teaser?: TeaserPick },
  room: RaceRoom | undefined
): PacingEstimate {
  if (room && !isTeaserRoom(room)) return stored.estimate;
  if (room && room.pacingEstimate?.id === stored.estimate.id) return teaserEstimate(stored.estimate, room);
  if (stored.teaser) return estimateShowing(stored.estimate, stored.teaser.checkpointId);
  return room ? teaserEstimate(stored.estimate, room) : stored.estimate;
}

/**
 * Runner's room teaser: the course geometry and checkpoint list stay so the app can draw the
 * map. The plan curve (`course.baselineTrack`, which prices every checkpoint) is dropped, and the
 * attached estimate keeps the shown aid station's ETA only. Returns a copy: `room` may be the
 * cached object.
 */
export function teaserRoom(room: RaceRoom): RaceRoom {
  const shaped = withoutPlanCurve(room);
  if (room.pacingEstimate) {
    shaped.pacingEstimate = teaserEstimate(room.pacingEstimate, room);
  }
  return shaped;
}

/**
 * What any other member sees of an unpaid race (crew left over after a refund, a manager who
 * created it): the room, roster and entitlement, so lists and the paywall render, the course for
 * the map, and no plan at all. Never more than the runner's own teaser.
 */
export function lockedRoom(room: RaceRoom): RaceRoom {
  const shaped = withoutPlanCurve(room);
  delete shaped.pacingEstimate;
  delete shaped.pacingEstimateId;
  return shaped;
}

/**
 * The one serializer for a RaceRoom in a response. Paid (and expired) rooms go out whole; an
 * unpaid race is the teaser for its runner and the locked room for everyone else. The teaser pin
 * is bookkeeping and never goes out.
 */
export function roomForViewer(room: RaceRoom, viewerUserId: string | undefined): RaceRoom {
  if (!isTeaserRoom(room)) return room.teaserCheckpoint === undefined ? room : withoutTeaserPin(room);
  return viewerUserId !== undefined && viewerUserId === room.athleteId ? teaserRoom(room) : lockedRoom(room);
}

function withoutTeaserPin(room: RaceRoom): RaceRoom {
  const { teaserCheckpoint: _bookkeeping, ...rest } = room;
  return rest;
}

function withoutPlanCurve(room: RaceRoom): RaceRoom {
  const shaped = withoutTeaserPin(room);
  if (room.course) {
    const { baselineTrack: _withheld, ...course } = room.course;
    shaped.course = course;
  }
  return shaped;
}
