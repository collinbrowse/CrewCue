/**
 * The teaser an unpaid race shows its runner during onboarding: the course, the finish ETA and
 * the first aid station's ETA. Every other checkpoint ETA is withheld here, on the server, and
 * teaser reads list the withheld checkpoints in `locked`. Pure: no storage, no Fastify.
 *
 * Crew get 402 on an unpaid race, so the runner exception in `evaluateEntitlement` is the only
 * way to reach a read that needs shaping. Callers shape when `isTeaserRoom(room)`.
 */
import type {
  CrewScheduleSheet,
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
 * so the first aid station is always a mid-course stop. With no such stop, only the start and
 * finish show.
 */
export function teaserCheckpointsOf(room: RaceRoom): TeaserCheckpoints {
  const ordered = courseOrder(room.course?.checkpoints ?? []);
  const start = ordered[0];
  const finish = ordered.length >= 2 ? ordered[ordered.length - 1] : undefined;
  const firstAid = ordered.find(
    (checkpoint) => checkpoint !== start && checkpoint !== finish && (checkpoint.tags ?? []).includes("aid")
  );
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
 * GET room teaser: the course geometry and checkpoint list stay so the app can draw the map.
 * The plan curve (`course.baselineTrack`, which prices every checkpoint) is dropped, and the
 * attached estimate keeps the first aid station's ETA only. Returns a copy: `room` may be the
 * cached object.
 */
export function teaserRoom(room: RaceRoom): RaceRoom {
  const { firstAidCheckpointId } = teaserCheckpointsOf(room);
  const shaped: RaceRoom = { ...room };
  if (room.course) {
    const { baselineTrack: _withheld, ...course } = room.course;
    shaped.course = course;
  }
  if (room.pacingEstimate) {
    shaped.pacingEstimate = {
      ...room.pacingEstimate,
      aidEtas: room.pacingEstimate.aidEtas.filter(
        (eta) => firstAidCheckpointId !== undefined && eta.checkpointId === firstAidCheckpointId
      )
    };
  }
  return shaped;
}
