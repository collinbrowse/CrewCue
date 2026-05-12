import type {
  CheckpointStoppageSummary,
  CheckpointVisit,
  CheckpointVisitAutoData,
  CheckpointVisitSource,
  ProjectionWeatherStub,
  RaceCourseBaselineTrack,
  RaceCourse,
  RaceCourseCheckpoint,
  RaceRoomProjectionCore,
  RaceCheckpointSplitRow
} from "@crewcue/contracts";
import {
  type CourseMetricPoint,
  geodesicDistanceMeters,
  geodesicPolylineLength,
  geodesicProjectPointToPolyline
} from "@crewcue/map-core";

const EPS_M = 0.05;

export const DEFAULT_PLANNED_PACE_SECONDS_PER_KM = 480;

/** Default straight-line course (~2.2 km) used when activation omits `course`. */
export const DEFAULT_RACE_COURSE: RaceCourse = {
  checkpoints: [
    { id: "cp-start", latitude: 36.5, longitude: -118.5 },
    { id: "cp-mid", latitude: 36.51, longitude: -118.5 },
    { id: "cp-finish", latitude: 36.52, longitude: -118.5 }
  ]
};

type VisitAccumulator = {
  arrivalRecordedAt: string | null;
  departureRecordedAt: string | null;
  firstSlowedAt: string | null;
  accumulatedStopSeconds: number;
};

type ProjectionPreviousCheckpointVisit = {
  visitIndex: number;
  resolvedSource: CheckpointVisitSource;
  manualEntry?: CheckpointVisit["manualEntry"];
  note?: string;
};

function checkpointsAsMetricPoints(checkpoints: RaceCourseCheckpoint[]): CourseMetricPoint[] {
  return checkpoints.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
}

/**
 * Cumulative arc length at each checkpoint along the canonical route (from `distanceMetersFromStart`
 * on each checkpoint, computed at course save). Chord-only fallback is not supported.
 */
export function cumulativeDistanceAtCheckpoints(checkpoints: RaceCourseCheckpoint[]): number[] {
  if (checkpoints.length === 0) {
    return [];
  }
  if (
    !checkpoints.every(
      (c) => typeof c.distanceMetersFromStart === "number" && Number.isFinite(c.distanceMetersFromStart)
    )
  ) {
    throw new Error("checkpoint_distance_meters_from_start_required");
  }
  return checkpoints.map((c) => c.distanceMetersFromStart!);
}

export function hasUsableBaselineTrack(
  baselineTrack: RaceCourseBaselineTrack | undefined,
  courseLengthMeters: number
): baselineTrack is RaceCourseBaselineTrack {
  if (!baselineTrack || baselineTrack.points.length < 2) {
    return false;
  }

  let prevDistance = -1;
  let prevElapsed = -1;
  for (const point of baselineTrack.points) {
    if (!Number.isFinite(point.distanceMetersFromStart) || !Number.isFinite(point.referenceElapsedSeconds)) {
      return false;
    }
    if (point.distanceMetersFromStart < 0 || point.referenceElapsedSeconds < 0) {
      return false;
    }
    if (prevDistance >= 0 && point.distanceMetersFromStart <= prevDistance + EPS_M) {
      return false;
    }
    if (prevElapsed >= 0 && point.referenceElapsedSeconds <= prevElapsed + 1e-9) {
      return false;
    }
    prevDistance = point.distanceMetersFromStart;
    prevElapsed = point.referenceElapsedSeconds;
  }

  const firstPoint = baselineTrack.points[0]!;
  const lastPoint = baselineTrack.points[baselineTrack.points.length - 1]!;
  return firstPoint.distanceMetersFromStart <= EPS_M && lastPoint.distanceMetersFromStart + EPS_M >= courseLengthMeters;
}

function interpolateReferenceElapsedSeconds(
  baselineTrack: RaceCourseBaselineTrack,
  distanceMetersFromStart: number
): number {
  const clampedDistance = Math.max(0, distanceMetersFromStart);
  const points = baselineTrack.points;

  if (clampedDistance <= points[0]!.distanceMetersFromStart) {
    return points[0]!.referenceElapsedSeconds;
  }

  for (let index = 1; index < points.length; index++) {
    const prev = points[index - 1]!;
    const next = points[index]!;
    if (clampedDistance <= next.distanceMetersFromStart) {
      const spanDistance = next.distanceMetersFromStart - prev.distanceMetersFromStart;
      const t =
        spanDistance <= EPS_M ? 0 : (clampedDistance - prev.distanceMetersFromStart) / spanDistance;
      return prev.referenceElapsedSeconds + t * (next.referenceElapsedSeconds - prev.referenceElapsedSeconds);
    }
  }

  return points[points.length - 1]!.referenceElapsedSeconds;
}

function plannedElapsedSecondsForDistance(input: {
  distanceMetersFromStart: number;
  plannedPaceSecondsPerKm: number;
  baselineTrack?: RaceCourseBaselineTrack;
  courseLengthMeters: number;
}): number {
  const { distanceMetersFromStart, plannedPaceSecondsPerKm, baselineTrack, courseLengthMeters } = input;
  if (hasUsableBaselineTrack(baselineTrack, courseLengthMeters)) {
    return interpolateReferenceElapsedSeconds(baselineTrack, distanceMetersFromStart);
  }
  return (distanceMetersFromStart / 1000) * plannedPaceSecondsPerKm;
}

function checkpointRadiusMeters(checkpoint: RaceCourseCheckpoint): number {
  return checkpoint.stoppageRadiusMeters ?? 150;
}

function checkpointPlannedStopSeconds(checkpoint: RaceCourseCheckpoint): number {
  return Math.max(0, checkpoint.plannedStopSeconds ?? 0);
}

function checkpointSlowdownThresholdRatio(checkpoint: RaceCourseCheckpoint): number {
  return checkpoint.slowdownThresholdRatio ?? 0.5;
}

function pingDistanceMeters(_origin: RaceCourseCheckpoint, a: ProjectionPing, b: ProjectionPing): number {
  return geodesicDistanceMeters(
    { latitude: a.latitude, longitude: a.longitude },
    { latitude: b.latitude, longitude: b.longitude }
  );
}

function pingToCheckpointDistanceMeters(
  _origin: RaceCourseCheckpoint,
  ping: ProjectionPing,
  checkpoint: RaceCourseCheckpoint
): number {
  return geodesicDistanceMeters(
    { latitude: ping.latitude, longitude: ping.longitude },
    { latitude: checkpoint.latitude, longitude: checkpoint.longitude }
  );
}

function isPingInsideRadius(
  origin: RaceCourseCheckpoint,
  ping: ProjectionPing,
  checkpoint: RaceCourseCheckpoint
): boolean {
  return pingToCheckpointDistanceMeters(origin, ping, checkpoint) <= checkpointRadiusMeters(checkpoint);
}

/**
 * Closest point on the checkpoint geodesic polyline and distance along the path to that point.
 */
export function polylineCourseLengthAndProgress(
  checkpoints: RaceCourseCheckpoint[],
  pingLat: number,
  pingLon: number
): { courseLengthMeters: number; progressMeters: number } {
  const projected = geodesicProjectPointToPolyline(checkpointsAsMetricPoints(checkpoints), {
    latitude: pingLat,
    longitude: pingLon
  });
  return {
    courseLengthMeters: projected.courseLengthMeters,
    progressMeters: projected.progressMeters
  };
}

export type ProjectionPing = {
  pingId: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

export type ProjectionPreviousState = {
  lastProgressMeters: number;
  splitCrossedAt: Record<string, string>;
  visitStates: Record<string, VisitAccumulator[]>;
  visitMeta: Record<string, ProjectionPreviousCheckpointVisit[]>;
  rollingMovingSpeedMps: number;
};

/** Deterministic headwind assumption by course progress (Chunk D1 stub until a weather provider exists). */
export function buildProjectionWeatherStub(input: {
  progressMeters: number;
  courseLengthMeters: number;
}): ProjectionWeatherStub {
  const ratio =
    input.courseLengthMeters > 0 ? input.progressMeters / input.courseLengthMeters : 0;
  const segment =
    ratio < 1 / 3 ? "early_course" : ratio < 2 / 3 ? "mid_course" : "late_course";
  const assumedHeadwindMps =
    segment === "early_course" ? 2.0 : segment === "mid_course" ? 1.2 : 0.6;
  return {
    source: "stub",
    summary: `Synthetic baseline (${segment.replace("_", " ")}); replace with a weather provider when available.`,
    assumedHeadwindMps
  };
}

function resolveCanonicalCourseLengthMeters(input: {
  course: RaceCourse;
  routeMetricPoints: CourseMetricPoint[];
  canonicalCourseLengthMeters?: number;
}): number {
  const routeLen = geodesicPolylineLength(input.routeMetricPoints);
  const derived = input.course.derivedMetrics?.canonicalDistanceMeters;
  const fromRoom =
    typeof input.canonicalCourseLengthMeters === "number" &&
    Number.isFinite(input.canonicalCourseLengthMeters) &&
    input.canonicalCourseLengthMeters > 0
      ? input.canonicalCourseLengthMeters
      : undefined;
  const canonical =
    typeof derived === "number" && Number.isFinite(derived) && derived > 0
      ? derived
      : fromRoom ?? routeLen;
  if (!Number.isFinite(canonical) || canonical <= 0) {
    throw new Error("canonical_course_length_unresolved");
  }
  return canonical;
}

export function recomputeRaceProjection(params: {
  roomId: string;
  activatedAt: string;
  course: RaceCourse;
  plannedPaceSecondsPerKm: number;
  ping: ProjectionPing;
  previousPing?: ProjectionPing | null;
  previous: ProjectionPreviousState | null;
  /** Dense route polyline (GPX / workspace); required for along-track progress. */
  routeMetricPoints: CourseMetricPoint[];
  /** Denormalized room distance when `derivedMetrics` is absent (tests / transitional payloads). */
  canonicalCourseLengthMeters?: number;
}): { projection: RaceRoomProjectionCore; state: ProjectionPreviousState } {
  const {
    roomId,
    activatedAt,
    course,
    plannedPaceSecondsPerKm,
    ping,
    previous,
    previousPing,
    routeMetricPoints,
    canonicalCourseLengthMeters
  } = params;
  const activatedAtMs = Date.parse(activatedAt);
  const recordedAtMs = Date.parse(ping.recordedAt);
  if (Number.isNaN(activatedAtMs) || Number.isNaN(recordedAtMs)) {
    throw new Error("Invalid ISO timestamps for projection");
  }
  if (!Array.isArray(routeMetricPoints) || routeMetricPoints.length < 2) {
    throw new Error("route_metric_points_required");
  }

  const courseLengthMeters = resolveCanonicalCourseLengthMeters({
    course,
    routeMetricPoints,
    canonicalCourseLengthMeters
  });
  const alongRoute = geodesicProjectPointToPolyline(routeMetricPoints, {
    latitude: ping.latitude,
    longitude: ping.longitude
  });
  const progressMeters = Math.min(
    courseLengthMeters,
    Math.max(0, Math.min(alongRoute.progressMeters, alongRoute.courseLengthMeters))
  );

  const cumAt = cumulativeDistanceAtCheckpoints(course.checkpoints);
  const splitCrossedAt: Record<string, string> = { ...previous?.splitCrossedAt };
  const visitStates: Record<string, VisitAccumulator[]> = Object.fromEntries(
    Object.entries(previous?.visitStates ?? {}).map(([checkpointId, visits]) => [
      checkpointId,
      visits.map((visit) => ({ ...visit }))
    ])
  );
  const visitMeta: Record<string, ProjectionPreviousCheckpointVisit[]> = Object.fromEntries(
    Object.entries(previous?.visitMeta ?? {}).map(([checkpointId, visits]) => [
      checkpointId,
      visits.map((visit) => ({ ...visit }))
    ])
  );

  if (previous === null) {
    splitCrossedAt[course.checkpoints[0].id] = activatedAt;
  }

  const prevProgress = previous?.lastProgressMeters ?? -1;
  for (let k = 1; k < course.checkpoints.length; k++) {
    const at = cumAt[k];
    const crossed = progressMeters + EPS_M >= at && prevProgress < at - EPS_M;
    if (crossed && !splitCrossedAt[course.checkpoints[k].id]) {
      splitCrossedAt[course.checkpoints[k].id] = ping.recordedAt;
    }
  }

  const origin = course.checkpoints[0]!;
  const currentIsInsideAny = course.checkpoints.some((cp) => isPingInsideRadius(origin, ping, cp));
  let rollingMovingSpeedMps = previous?.rollingMovingSpeedMps ?? 1000 / plannedPaceSecondsPerKm;
  const intervalSeconds =
    previousPing !== null && previousPing !== undefined
      ? (recordedAtMs - Date.parse(previousPing.recordedAt)) / 1000
      : 0;
  const intervalDistanceMeters =
    previousPing !== null && previousPing !== undefined
      ? pingDistanceMeters(origin, previousPing, ping)
      : 0;
  const pingSpeedMps = intervalDistanceMeters / Math.max(intervalSeconds, 0.001);
  if (
    previousPing !== null &&
    previousPing !== undefined &&
    intervalSeconds > 0 &&
    Number.isFinite(pingSpeedMps) &&
    !currentIsInsideAny
  ) {
    rollingMovingSpeedMps = 0.3 * pingSpeedMps + 0.7 * rollingMovingSpeedMps;
  }

  if (previousPing !== null && previousPing !== undefined && intervalSeconds > 0) {
    for (const cp of course.checkpoints) {
      const checkpointId = cp.id;
      const visits = visitStates[checkpointId] ?? [];
      const metadata = visitMeta[checkpointId] ?? [];
      const prevInRadius = isPingInsideRadius(origin, previousPing, cp);
      const currInRadius = isPingInsideRadius(origin, ping, cp);
      let currentVisit = visits.length > 0 ? visits[visits.length - 1] : undefined;

      if (!prevInRadius && currInRadius) {
        let shouldPushVisit = false;
        if (!currentVisit) {
          shouldPushVisit = true;
        } else if (currentVisit.departureRecordedAt) {
          const checkpointDistanceMeters = cumAt[course.checkpoints.findIndex((x) => x.id === checkpointId)] ?? 0;
          const isBackwardReturn = progressMeters <= checkpointDistanceMeters + EPS_M;
          shouldPushVisit = isBackwardReturn;
        }
        if (shouldPushVisit) {
          currentVisit = {
            arrivalRecordedAt: ping.recordedAt,
            departureRecordedAt: null,
            firstSlowedAt: null,
            accumulatedStopSeconds: 0
          };
          visits.push(currentVisit);
          metadata.push({
            visitIndex: visits.length,
            resolvedSource: "auto"
          });
        }
      } else if (prevInRadius && !currInRadius && currentVisit && !currentVisit.departureRecordedAt) {
        currentVisit.departureRecordedAt = ping.recordedAt;
      } else if (prevInRadius && currInRadius && currentVisit && !currentVisit.departureRecordedAt) {
        const threshold = rollingMovingSpeedMps * checkpointSlowdownThresholdRatio(cp);
        if (pingSpeedMps < threshold) {
          currentVisit.accumulatedStopSeconds += intervalSeconds;
          if (!currentVisit.firstSlowedAt) {
            currentVisit.firstSlowedAt = previousPing.recordedAt;
          }
        }
      }

      if (visits.length > 0) {
        visitStates[checkpointId] = visits;
      }
      if (metadata.length > 0) {
        visitMeta[checkpointId] = metadata;
      }
    }
  }

  const checkpointSplits: RaceCheckpointSplitRow[] = course.checkpoints.map((cp, k) => {
    const at = cumAt[k];
    const crossedAt = splitCrossedAt[cp.id] ?? null;
    const plannedElapsedSecondsAtCross = plannedElapsedSecondsForDistance({
      distanceMetersFromStart: at,
      plannedPaceSecondsPerKm,
      baselineTrack: course.baselineTrack,
      courseLengthMeters
    });
    let actualElapsedSecondsAtCross: number | null = null;
    let deltaSecondsAtCross: number | null = null;
    if (crossedAt) {
      const crossMs = Date.parse(crossedAt);
      if (!Number.isNaN(crossMs)) {
        actualElapsedSecondsAtCross = (crossMs - activatedAtMs) / 1000;
        deltaSecondsAtCross = actualElapsedSecondsAtCross - plannedElapsedSecondsAtCross;
      }
    }
    const visits = (visitStates[cp.id] ?? []).map((visit, index): CheckpointVisit => {
      const metadata = visitMeta[cp.id]?.[index];
      const autoDetected: CheckpointVisitAutoData = {
        arrivalRecordedAt: visit.arrivalRecordedAt,
        departureRecordedAt: visit.departureRecordedAt,
        firstSlowedAt: visit.firstSlowedAt,
        actualStopSeconds: visit.accumulatedStopSeconds > 0 ? visit.accumulatedStopSeconds : null
      };
      const resolvedSource = metadata?.resolvedSource ?? "auto";
      const activeActualStopSeconds =
        resolvedSource === "manual_crew"
          ? (metadata?.manualEntry?.actualStopSeconds ?? null)
          : autoDetected.actualStopSeconds;
      return {
        visitIndex: index + 1,
        resolvedSource,
        autoDetected,
        ...(metadata?.manualEntry ? { manualEntry: metadata.manualEntry } : {}),
        activeActualStopSeconds,
        ...(metadata?.note ? { note: metadata.note } : {})
      };
    });
    const totalActualStopSeconds = visits.reduce<number | null>((acc, visit) => {
      if (visit.activeActualStopSeconds === null) {
        return acc;
      }
      return (acc ?? 0) + visit.activeActualStopSeconds;
    }, null);
    const plannedStopSeconds = checkpointPlannedStopSeconds(cp);
    const deltaStopSeconds =
      totalActualStopSeconds === null ? null : totalActualStopSeconds - plannedStopSeconds;

    return {
      checkpointId: cp.id,
      distanceMetersFromStart: at,
      crossedAtRecordedAt: crossedAt,
      plannedElapsedSecondsAtCross,
      actualElapsedSecondsAtCross,
      deltaSecondsAtCross,
      plannedStopSeconds,
      visits,
      totalActualStopSeconds,
      deltaStopSeconds
    };
  });

  const finishReferenceElapsedSeconds = plannedElapsedSecondsForDistance({
    distanceMetersFromStart: courseLengthMeters,
    plannedPaceSecondsPerKm,
    baselineTrack: course.baselineTrack,
    courseLengthMeters
  });

  const remainingPlannedStopSecondsAhead = checkpointSplits.reduce((sum, row) => {
    const reached = row.visits.length > 0;
    return sum + (reached ? 0 : row.plannedStopSeconds);
  }, 0);

  const currentCheckpointRemainingStop = checkpointSplits.reduce((remaining, row) => {
    const lastVisit = row.visits[row.visits.length - 1];
    if (!lastVisit || !lastVisit.autoDetected) {
      return remaining;
    }
    const inProgress = lastVisit.autoDetected.firstSlowedAt !== null && lastVisit.autoDetected.departureRecordedAt === null;
    if (!inProgress) {
      return remaining;
    }
    return Math.max(remaining, Math.max(0, row.plannedStopSeconds - (lastVisit.autoDetected.actualStopSeconds ?? 0)));
  }, 0);

  const etaFinishMs = hasUsableBaselineTrack(course.baselineTrack, courseLengthMeters)
    ? (() => {
        const anchor =
          [...checkpointSplits]
            .reverse()
            .find((row) => row.actualElapsedSecondsAtCross !== null) ?? checkpointSplits[0]!;
        const anchorActualElapsedSeconds = anchor.actualElapsedSecondsAtCross ?? 0;
        const anchoredFinishElapsedSeconds =
          anchorActualElapsedSeconds +
          Math.max(0, finishReferenceElapsedSeconds - anchor.plannedElapsedSecondsAtCross);
        return Math.max(
          recordedAtMs,
          activatedAtMs +
            (anchoredFinishElapsedSeconds + remainingPlannedStopSecondsAhead + currentCheckpointRemainingStop) *
              1000
        );
      })()
    : (() => {
        const remainingM = Math.max(0, courseLengthMeters - progressMeters);
        const remainingSec = (remainingM / 1000) * plannedPaceSecondsPerKm;
      return (
        recordedAtMs +
        (remainingSec + remainingPlannedStopSecondsAhead + currentCheckpointRemainingStop) * 1000
      );
      })();
  const etaFinishPlanIso = new Date(etaFinishMs).toISOString();

  const completedRows = checkpointSplits.filter((row) =>
    row.visits.some((visit) => {
      if (visit.resolvedSource === "manual_crew") {
        return visit.manualEntry !== undefined;
      }
      return visit.autoDetected?.departureRecordedAt !== null && visit.autoDetected?.departureRecordedAt !== undefined;
    })
  );
  const totalPlannedStopSeconds = checkpointSplits.reduce((sum, row) => sum + row.plannedStopSeconds, 0);
  const totalActualStopSeconds = completedRows.reduce((sum, row) => {
    return (
      sum +
      row.visits.reduce((visitSum, visit) => visitSum + (visit.activeActualStopSeconds ?? 0), 0)
    );
  }, 0);
  const completedPlannedStopSeconds = completedRows.reduce((sum, row) => sum + row.plannedStopSeconds, 0);
  const raceElapsedSeconds = Math.max(0, (recordedAtMs - activatedAtMs) / 1000);
  const stoppageSummary: CheckpointStoppageSummary = {
    totalPlannedStopSeconds,
    totalActualStopSeconds,
    totalDeltaStopSeconds:
      completedRows.length > 0 ? totalActualStopSeconds - completedPlannedStopSeconds : null,
    stoppageTimePercent:
      completedRows.length > 0 && raceElapsedSeconds > 0
        ? (totalActualStopSeconds / raceElapsedSeconds) * 100
        : null,
    remainingPlannedStopSeconds: remainingPlannedStopSecondsAhead
  };

  const projection: RaceRoomProjectionCore = {
    roomId,
    asOfPingId: ping.pingId,
    asOfRecordedAt: ping.recordedAt,
    progressMeters,
    courseLengthMeters,
    plannedPaceSecondsPerKm,
    etaFinishPlanIso,
    checkpointSplits,
    stoppageSummary,
    weatherStub: buildProjectionWeatherStub({ progressMeters, courseLengthMeters })
  };

  return {
    projection,
    state: {
      lastProgressMeters: progressMeters,
      splitCrossedAt,
      visitStates,
      visitMeta,
      rollingMovingSpeedMps
    }
  };
}
