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
import type { CrewScheduleSheet, PacingEstimate, RaceCourseCheckpoint, RaceRoom, RaceRoomProjection } from "@crewcue/contracts";
import { hasUsableBaselineTrack, plannedElapsedSecondsForDistance } from "./raceProjection.js";

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
 * Projection teaser: the finish ETA (`etaFinishPlanIso`, `etaFinishWindow`) and course-level
 * fields stay; `checkpointSplits` and `remainingCheckpointEtas` carry no checkpoint rows.
 *
 * `preRace`: no ping from the runner has been accepted, so the projection is the bootstrap, which
 * places the runner at the first listed checkpoint and anchors the finish on the first split.
 * The runner picks both by editing the course, and the finish from a mid-course stop is the finish
 * minus that stop's ETA. A pre-race teaser shows the finish from the start line instead
 * (`startLineFinishIso`), and no window, which is centred on the same origin.
 */
export function teaserProjection(
  projection: RaceRoomProjection,
  room: RaceRoom,
  options: { preRace?: boolean } = {}
): RaceRoomProjection {
  const shaped: RaceRoomProjection = {
    ...projection,
    checkpointSplits: [],
    ...(projection.remainingCheckpointEtas ? { remainingCheckpointEtas: [] } : {}),
    locked: { checkpointIds: teaserCheckpointsOf(room).lockedCheckpointIds }
  };
  if (options.preRace) {
    shaped.etaFinishPlanIso = startLineFinishIso(projection, room);
    delete shaped.etaFinishWindow;
  }
  return shaped;
}

/**
 * The pre-race finish from the start line, as the projection computes it for a runner standing at
 * the start: the plan curve to the course length plus every planned stop, never earlier than when
 * the projection was taken; without a usable plan curve, planned pace over the course from then.
 * It reads only the course length, so no checkpoint edit moves it.
 */
function startLineFinishIso(projection: RaceRoomProjection, room: RaceRoom): string {
  const recordedAtMs = Date.parse(projection.asOfRecordedAt);
  const anchorMs = Date.parse(room.raceStartAt?.trim() || room.activatedAt?.trim() || projection.asOfRecordedAt);
  const lengthMeters = projection.courseLengthMeters;
  const paceSecondsPerKm = projection.plannedPaceSecondsPerKm;
  const plannedStopSeconds = (room.course?.checkpoints ?? []).reduce(
    (sum, checkpoint) => sum + Math.max(0, checkpoint.plannedStopSeconds ?? 0),
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
    : recordedAtMs + ((lengthMeters / 1000) * paceSecondsPerKm + plannedStopSeconds) * 1000;
  return new Date(finishMs).toISOString();
}

/**
 * Schedule teaser: the start and finish stops only. Build `sheet` from `teaserRoom(room)` (no
 * plan curve, the finish-only plan), so the two rows it keeps read the finish ETA (or planned
 * pace) alone: a course re-saved so a priced stop is its first or last row would otherwise carry
 * that stop's ETA.
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
 * Whether a stored estimate is tied to a paid race in `callerRooms` (the caller's own races):
 * the race it was computed for or last attached to (`roomId`), or a race whose plan of record
 * it is.
 */
function tiedToPaidRace(stored: { estimate: PacingEstimate; roomId?: string }, callerRooms: readonly RaceRoom[]): boolean {
  return callerRooms.some(
    (room) =>
      room.entitlement.status === "paid" &&
      ((stored.roomId !== undefined && room.id === stored.roomId) ||
        room.pacingEstimateId === stored.estimate.id ||
        room.pacingEstimate?.id === stored.estimate.id)
  );
}

/**
 * A stored estimate as `GET /me/export` returns it: whole when tied to a paid race the caller
 * belongs to, else finish-only (an unpaid race's estimates, and room-less ones).
 */
export function exportedEstimate(
  stored: { estimate: PacingEstimate; roomId?: string },
  callerRooms: readonly RaceRoom[]
): PacingEstimate {
  return tiedToPaidRace(stored, callerRooms) ? stored.estimate : finishOnlyEstimate(stored.estimate);
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
