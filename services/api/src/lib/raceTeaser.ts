/**
 * The teaser an unpaid race shows its runner during onboarding: the course, the finish ETA and
 * the first aid station's ETA. Every other checkpoint ETA is withheld here, on the server, and
 * teaser reads list the withheld checkpoints in `locked`. Pure: no storage, no Fastify.
 *
 * Crew get 402 on the gated reads of an unpaid race. Routes that answer any member with a 200
 * (lists, join, accept, member edits, course and plan writes) still serialize the room, so every
 * RaceRoom a route sends goes through `roomForViewer`, and every PacingEstimate a route sends for
 * an unpaid race goes through `teaserEstimate`.
 */
import type {
  CrewScheduleSheet,
  PacingEstimate,
  RaceCourseCheckpoint,
  RaceRoom,
  RaceRoomProjection
} from "@crewcue/contracts";

export function isTeaserRoom(room: RaceRoom): boolean {
  return room.entitlement.status === "unpaid";
}

export type TeaserCheckpoints = {
  startCheckpointId?: string;
  /** First `aid`-tagged checkpoint after the start and before the finish. */
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
  const measured = checkpoints.every(
    (checkpoint) =>
      typeof checkpoint.distanceMetersFromStart === "number" && Number.isFinite(checkpoint.distanceMetersFromStart)
  );
  const ordered = [...checkpoints];
  if (measured) {
    ordered.sort((a, b) => a.distanceMetersFromStart! - b.distanceMetersFromStart!);
  }
  return ordered;
}

/**
 * Which checkpoints a teaser shows. Aid stations come from the `aid` tag, not from position:
 * the first stop is the start. A start or finish tagged `aid` is still the start or finish,
 * so the first aid station is always a mid-course stop. A course with no mid-course `aid` tag (a
 * GPX import whose stops are only named "Aid 1"...) falls back to the first mid-course stop the
 * estimator gave an aid ETA (`estimate`, default the room's plan of record), so the teaser keeps
 * the stop the plan actually prices. With neither, only the start and finish show.
 */
export function teaserCheckpointsOf(
  room: RaceRoom,
  estimate: PacingEstimate | undefined = room.pacingEstimate
): TeaserCheckpoints {
  const ordered = courseOrder(room.course?.checkpoints ?? []);
  const start = ordered[0];
  const finish = ordered.length >= 2 ? ordered[ordered.length - 1] : undefined;
  const midCourse = ordered.filter((checkpoint) => checkpoint !== start && checkpoint !== finish);
  const pricedIds = new Set((estimate?.aidEtas ?? []).map((eta) => eta.checkpointId));
  const firstAid =
    midCourse.find((checkpoint) => (checkpoint.tags ?? []).includes("aid")) ??
    midCourse.find((checkpoint) => pricedIds.has(checkpoint.id));
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

/**
 * Projection teaser: the finish ETA and course-level fields stay; `checkpointSplits` and
 * `remainingCheckpointEtas` keep the first aid station only.
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

/** Schedule teaser: the start, first aid and finish stops; the rest are dropped. */
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

/**
 * Estimate teaser: the finish (expected time, bands) and the first aid station's ETA. Used for
 * the attached plan in a teaser room and for every estimate a route returns on an unpaid race.
 * The stored estimate stays whole, so paying unlocks it without a recompute.
 */
export function teaserEstimate(estimate: PacingEstimate, room: RaceRoom): PacingEstimate {
  const { firstAidCheckpointId } = teaserCheckpointsOf(room, estimate);
  return {
    ...estimate,
    aidEtas: estimate.aidEtas.filter(
      (eta) => firstAidCheckpointId !== undefined && eta.checkpointId === firstAidCheckpointId
    )
  };
}

/**
 * Runner's room teaser: the course geometry and checkpoint list stay so the app can draw the
 * map. The plan curve (`course.baselineTrack`, which prices every checkpoint) is dropped, and the
 * attached estimate keeps the first aid station's ETA only. Returns a copy: `room` may be the
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
 * unpaid race is the teaser for its runner and the locked room for everyone else.
 */
export function roomForViewer(room: RaceRoom, viewerUserId: string | undefined): RaceRoom {
  if (!isTeaserRoom(room)) return room;
  return viewerUserId !== undefined && viewerUserId === room.athleteId ? teaserRoom(room) : lockedRoom(room);
}

function withoutPlanCurve(room: RaceRoom): RaceRoom {
  const shaped: RaceRoom = { ...room };
  if (room.course) {
    const { baselineTrack: _withheld, ...course } = room.course;
    shaped.course = course;
  }
  return shaped;
}
