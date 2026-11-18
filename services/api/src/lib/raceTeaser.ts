/**
 * The teaser an unpaid race shows its runner during onboarding: the course and the finish ETA.
 * Every mid-course ETA is withheld here, on the server: no aid station or other checkpoint
 * between the start and the finish shows an ETA, whatever the course's tags, order or
 * checkpoints. Teaser reads list the withheld checkpoints in `locked`. Pure: no storage, no
 * Fastify.
 *
 * Crew get 402 on the gated reads of an unpaid race. Routes that answer any member with a 200
 * (lists, join, accept, member edits, course and plan writes) still serialize the room, so every
 * RaceRoom a route sends goes through `roomForViewer`, and every PacingEstimate a route sends for
 * an unpaid race goes through `finishOnlyEstimate`.
 */
import type {
  CrewScheduleSheet,
  PacingEstimate,
  RaceCourseBaselineTrack,
  RaceCourseCheckpoint,
  RaceRoom,
  RaceRoomProjection
} from "@crewcue/contracts";
import { geodesicPolylineLength, type CourseMetricPoint } from "@crewcue/map-core";
import {
  finishCheckpointIndex,
  hasUsableBaselineTrack,
  plannedElapsedSecondsForDistance,
  withinCourseLength
} from "./raceProjection.js";

/** Where a stored estimate went (see `StoredPacingEstimate` in pacingEstimateStore.ts). */
export type EstimateProvenance = {
  estimate: PacingEstimate;
  /** Every race it was computed for or attached to. */
  roomIds: readonly string[];
  /** Stored before provenance was tracked, so `roomIds` may miss races it went to. */
  legacyProvenance: boolean;
};

export function isTeaserRoom(room: RaceRoom): boolean {
  return room.entitlement.status === "unpaid";
}

export type TeaserCheckpoints = {
  startCheckpointId?: string;
  finishCheckpointId?: string;
  /** Every checkpoint between the start and the finish, in course order. Their ETAs are withheld. */
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

/** The start (first in course order), the finish (last) and every checkpoint between them, locked. */
export function teaserCheckpointsOf(room: RaceRoom): TeaserCheckpoints {
  const ordered = courseOrder(room.course?.checkpoints ?? []);
  const start = ordered[0];
  const finish = ordered.length >= 2 ? ordered[ordered.length - 1] : undefined;
  const shown = new Set([start?.id, finish?.id].filter((id): id is string => id !== undefined));
  const locked: string[] = [];
  for (const checkpoint of ordered) {
    if (!shown.has(checkpoint.id) && !locked.includes(checkpoint.id)) {
      locked.push(checkpoint.id);
    }
  }
  return {
    ...(start ? { startCheckpointId: start.id } : {}),
    ...(finish ? { finishCheckpointId: finish.id } : {}),
    lockedCheckpointIds: locked
  };
}

/**
 * Estimate teaser: the finish (expected time, bands) and no aid ETA at all. Used for the attached
 * plan in a teaser room, for every estimate a route returns on an unpaid race, for room-less
 * estimates, and in the export. The stored estimate stays whole, so paying unlocks it without a
 * recompute.
 */
export function finishOnlyEstimate(estimate: PacingEstimate): PacingEstimate {
  return { ...estimate, aidEtas: [] };
}

/**
 * Projection teaser: the finish ETA (`etaFinishPlanIso`) and course-level fields stay;
 * `checkpointSplits` and `remainingCheckpointEtas` carry no checkpoint rows.
 *
 * The finish is always the finish from the start line (`startLineFinishIso`), with no window,
 * never the projection's own. The projection measures the finish from where it places the runner:
 * the first listed checkpoint before any accepted ping (the bootstrap), the last ping after. The
 * runner picks both, by editing the course or by where they ping from, and the finish from a
 * mid-course point is the finish minus that point's ETA. The window is centred on the same origin.
 */
export function teaserProjection(projection: RaceRoomProjection, room: RaceRoom): RaceRoomProjection {
  const shaped: RaceRoomProjection = {
    ...projection,
    checkpointSplits: [],
    ...(projection.remainingCheckpointEtas ? { remainingCheckpointEtas: [] } : {}),
    locked: { checkpointIds: teaserCheckpointsOf(room).lockedCheckpointIds },
    etaFinishPlanIso: startLineFinishIso(projection, room)
  };
  delete shaped.etaFinishWindow;
  return shaped;
}

/**
 * A projection as a route returns it to the runner: the teaser on an unpaid race (see
 * `teaserProjection`), else as is. The ping routes reply through this, so a ping to an unpaid
 * race (402 today) could never carry more than the teaser if that gate opened: its finish does not
 * move with the ping's position.
 */
export function projectionForRoom(projection: RaceRoomProjection, room: RaceRoom): RaceRoomProjection {
  return isTeaserRoom(room) ? teaserProjection(projection, room) : projection;
}

/**
 * The finish from the start line, as the projection computes it for a runner standing at the
 * start: the plan curve to the course length plus every planned stop before the finish, never
 * earlier than when the projection was taken; without a usable plan curve, planned pace over the
 * course from then, or from the start when the projection was taken before it. The finish
 * checkpoint's own stop is after the finish line; which checkpoint that is, if any, is the
 * projection's rule (`finishCheckpointIndex`), so on a course with no finish waypoint every stop
 * counts, the last aid's too, as on a paid race. It reads only the course length and the planned
 * stops, so no ping position moves it.
 */
function startLineFinishIso(projection: RaceRoomProjection, room: RaceRoom): string {
  const recordedAtMs = Date.parse(projection.asOfRecordedAt);
  const anchorMs = Date.parse(room.raceStartAt?.trim() || room.activatedAt?.trim() || projection.asOfRecordedAt);
  const lengthMeters = projection.courseLengthMeters;
  const paceSecondsPerKm = projection.plannedPaceSecondsPerKm;
  const checkpoints = room.course?.checkpoints ?? [];
  const finishIndex = finishCheckpointIndex(checkpoints, lengthMeters);
  const plannedStopSeconds = checkpoints.reduce(
    (sum, checkpoint, index) =>
      index === finishIndex ? sum : sum + Math.max(0, checkpoint.plannedStopSeconds ?? 0),
    0
  );
  const baselineTrack = room.course?.baselineTrack;
  const finishMs = hasUsableBaselineTrack(baselineTrack, lengthMeters)
    ? Math.max(
        recordedAtMs,
        anchorMs +
          (plannedElapsedSecondsForDistance({
            distanceMetersFromStart: lengthMeters,
            plannedPaceSecondsPerKm: paceSecondsPerKm,
            baselineTrack,
            courseLengthMeters: lengthMeters
          }) +
            plannedStopSeconds) *
            1000
      )
    : (Number.isNaN(anchorMs) ? recordedAtMs : Math.max(recordedAtMs, anchorMs)) +
      ((lengthMeters / 1000) * paceSecondsPerKm + plannedStopSeconds) * 1000;
  return new Date(finishMs).toISOString();
}

/**
 * Schedule teaser: the start and finish stops only. Build `sheet` from `teaserScheduleRoom(room)`
 * (the finish-only plan, the finish at the course length, the plan curve collapsed to its finish),
 * so the two rows it keeps read the finish ETA alone: a course re-saved so a priced stop is its
 * first or last row would otherwise carry that stop's ETA.
 */
export function teaserScheduleSheet(sheet: CrewScheduleSheet, room: RaceRoom): CrewScheduleSheet {
  const { startCheckpointId, finishCheckpointId, lockedCheckpointIds } = teaserCheckpointsOf(room);
  const shown = new Set([startCheckpointId, finishCheckpointId].filter((id): id is string => id !== undefined));
  return {
    ...sheet,
    stops: sheet.stops.filter((stop) => shown.has(stop.checkpointId)),
    locked: { checkpointIds: lockedCheckpointIds }
  };
}

/**
 * The room an unpaid race's schedule is built from: `teaserRoom` (the finish-only plan), with
 * the finish checkpoint placed at `courseLengthMeters` and the plan curve collapsed to two points,
 * 0 m at 0 s and `courseLengthMeters` at the curve's value there, instead of dropped. The finish
 * row then reads the race's finish at the course end (the attached plan's, else the curve's value
 * there, as the teaser projection reads it), never a priced stop's ETA, also when the checkpoints
 * stop short of the route's end: there the row stands in for the finish past it, and is built
 * with `teaserFinishStandInId` so it arrives after its own stop. Nothing between the start and
 * the finish reads more than a straight line to that finish. The sheet never carries the curve.
 * Without a usable curve it is dropped, as in `teaserRoom`. Pass `courseLengthOf(room, route)`,
 * the length the projection and an unpaid compute read the finish at.
 */
export function teaserScheduleRoom(room: RaceRoom, courseLengthMeters: number): RaceRoom {
  const shaped = teaserRoom(room);
  if (!shaped.course || !(courseLengthMeters > 0)) {
    return shaped;
  }
  const { finishCheckpointId } = teaserCheckpointsOf(room);
  const checkpoints = shaped.course.checkpoints.map((checkpoint) => {
    const distance = finiteDistance(checkpoint);
    return checkpoint.id === finishCheckpointId && distance !== undefined && distance < courseLengthMeters
      ? { ...checkpoint, distanceMetersFromStart: courseLengthMeters }
      : checkpoint;
  });
  shaped.course = { ...shaped.course, checkpoints };
  const curve = room.course?.baselineTrack;
  if (!hasUsableBaselineTrack(curve, courseLengthMeters)) {
    return shaped;
  }
  const finishSeconds = plannedElapsedSecondsForDistance({
    distanceMetersFromStart: courseLengthMeters,
    plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm ?? 0,
    baselineTrack: curve,
    courseLengthMeters
  });
  const collapsed: RaceCourseBaselineTrack = {
    points: [
      { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
      { distanceMetersFromStart: courseLengthMeters, referenceElapsedSeconds: finishSeconds }
    ]
  };
  if (hasUsableBaselineTrack(collapsed, courseLengthMeters)) {
    shaped.course.baselineTrack = collapsed;
  }
  return shaped;
}

/**
 * The teaser's finish row on a course with no finish checkpoint (`finishCheckpointIndex` is -1:
 * the checkpoints stop short of the route's end and none is marked the finish): the farthest
 * checkpoint, which `teaserScheduleRoom` places at the course end. Its row stands in for the
 * finish past it, so it arrives after its own stop, as the projection and the teaser projection
 * count every stop toward the finish there, and paying shows the same finish. Undefined when a
 * checkpoint is the finish (its own stop is after the finish line) or there is no finish row.
 */
export function teaserFinishStandInId(room: RaceRoom, courseLengthMeters: number): string | undefined {
  const { finishCheckpointId } = teaserCheckpointsOf(room);
  if (finishCheckpointId === undefined) return undefined;
  return finishCheckpointIndex(room.course?.checkpoints ?? [], courseLengthMeters) < 0 ? finishCheckpointId : undefined;
}

function belongsTo(room: RaceRoom, userId: string): boolean {
  return room.athleteId === userId || room.memberships.some((member) => member.userId === userId);
}

function isPlanOfRecord(room: RaceRoom, estimateId: string): boolean {
  return room.pacingEstimateId === estimateId || room.pacingEstimate?.id === estimateId;
}

/**
 * Whether a stored estimate is tied to a paid race in `callerRooms` (the caller's own races):
 * a race it was computed for or attached to (`roomIds`), or a race whose plan of record it is.
 */
function tiedToPaidRace(stored: EstimateProvenance, callerRooms: readonly RaceRoom[]): boolean {
  return callerRooms.some(
    (room) =>
      room.entitlement.status === "paid" && (stored.roomIds.includes(room.id) || isPlanOfRecord(room, stored.estimate.id))
  );
}

/**
 * A stored estimate as `GET /me/export` returns it: whole when tied to a paid race the caller
 * belongs to, else finish-only (an unpaid race's estimates, and room-less ones). A legacy row
 * (stored before provenance was tracked, so it cannot say where it went) goes out whole while the
 * caller has no unpaid race, as it did before the teaser; once they have one, the rule above.
 */
export function exportedEstimate(stored: EstimateProvenance, callerRooms: readonly RaceRoom[]): PacingEstimate {
  if (stored.legacyProvenance && !callerRooms.some((room) => room.entitlement.status === "unpaid")) {
    return stored.estimate;
  }
  return tiedToPaidRace(stored, callerRooms) ? stored.estimate : finishOnlyEstimate(stored.estimate);
}

/**
 * Whether a stored estimate may become `target`'s plan of record, judged by where it went.
 * Returns the unpaid race that holds it back (answer 402 `room_unpaid`), or undefined.
 *
 * Allowed when `target` is in `roomIds`, or the estimate is already `target`'s plan of record.
 * Refused only when `roomIds` names another race that is unpaid now and names neither `target`
 * nor a paid race the caller belongs to (one that already shows the estimate whole).
 * `provenanceRooms`: the rooms `roomIds` names that still exist.
 */
export function attachBlockedBy(
  stored: EstimateProvenance,
  target: RaceRoom,
  callerUserId: string,
  provenanceRooms: readonly RaceRoom[]
): RaceRoom | undefined {
  if (stored.roomIds.includes(target.id) || isPlanOfRecord(target, stored.estimate.id)) return undefined;
  const others = provenanceRooms.filter((room) => room.id !== target.id && stored.roomIds.includes(room.id));
  if (others.some((room) => room.entitlement.status === "paid" && belongsTo(room, callerUserId))) return undefined;
  return others.find((room) => room.entitlement.status === "unpaid");
}

/**
 * How far an unpaid race's course may be from the length its plan was computed for: the course
 * length tolerance the projection and schedule also read the finish line with.
 */
export { COURSE_LENGTH_TOLERANCE_METERS, COURSE_LENGTH_TOLERANCE_RATIO } from "./raceProjection.js";

/**
 * A race's course length (m), the length the projection reads its finish at: the course's
 * canonical distance, else the room's, else the length of `route` (the room's route polyline,
 * which the micro-model simulates). Never a checkpoint's distance: checkpoints can stop short of
 * the route's end. Undefined when none is known (no stored length and no route).
 *
 * A race's compute, paid or unpaid, reads its finish here (`finishAtCourseEnd`). An unpaid race's
 * schedule puts its finish row here, and its attach takes only a plan computed for this length.
 */
export function courseLengthOf(
  room: RaceRoom,
  route: readonly CourseMetricPoint[] | null | undefined
): number | undefined {
  const canonical = room.course?.derivedMetrics?.canonicalDistanceMeters;
  if (isPositive(canonical)) return canonical;
  if (isPositive(room.courseDistanceMeters)) return room.courseDistanceMeters;
  const routeLength = route && route.length >= 2 ? geodesicPolylineLength([...route]) : undefined;
  return isPositive(routeLength) ? routeLength : undefined;
}

/**
 * The course length (m) a stored estimate was computed for: as recorded when it was computed,
 * else (a legacy row) where its plan curve ends. Undefined when neither is known.
 */
export function estimateCourseLengthMeters(stored: {
  courseLengthMeters?: number;
  baselineTrack?: RaceCourseBaselineTrack;
}): number | undefined {
  if (isPositive(stored.courseLengthMeters)) return stored.courseLengthMeters;
  const points = stored.baselineTrack?.points ?? [];
  const end = points[points.length - 1]?.distanceMetersFromStart;
  return isPositive(end) ? end : undefined;
}

/**
 * Whether an estimate computed for `estimateMeters` fits a course of `courseMeters`: within 1%
 * of the course or 100 m, whichever is larger. An unknown length never fits. Attaching a plan
 * whose curve runs past a shortened course would read the curve at the new finish, which is an
 * old mid-course split.
 */
export function courseLengthsMatch(estimateMeters: number | undefined, courseMeters: number | undefined): boolean {
  if (!isPositive(estimateMeters) || !isPositive(courseMeters)) return false;
  return withinCourseLength(estimateMeters, courseMeters);
}

function isPositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Runner's room teaser: the course geometry and checkpoint list stay so the app can draw the
 * map. The plan curve (`course.baselineTrack`, which prices every checkpoint) is dropped, and the
 * attached estimate keeps the finish only. Returns a copy: `room` may be the cached object.
 */
export function teaserRoom(room: RaceRoom): RaceRoom {
  const shaped = withoutPlanCurve(room);
  if (room.pacingEstimate) {
    shaped.pacingEstimate = finishOnlyEstimate(room.pacingEstimate);
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
  const shaped = { ...room };
  if (room.course) {
    const { baselineTrack: _withheld, ...course } = room.course;
    shaped.course = course;
  }
  return shaped;
}
