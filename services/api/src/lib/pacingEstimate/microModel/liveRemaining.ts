/**
 * Live remaining-course re-simulation vs frozen plan-of-record moving times.
 */
import type {
  RaceCourseBaselineTrack,
  RaceCourseCheckpoint,
  RemainingCheckpointEta
} from "@crewcue/contracts";
import type { CourseMetricPoint } from "@crewcue/map-core";
import { buildCourseMicroSegments } from "./courseMesh.js";
import { buildRunnerProfile, type RunnerProfile } from "./runnerProfile.js";
import { fatigueStateAtProgress, runScenarioSims } from "./scenarios.js";
import { interpolateElapsedAtDistance } from "./simulate.js";

export type LiveRemainingProjection = {
  remainingCheckpointEtas: RemainingCheckpointEta[];
  etaFinishElapsedSeconds: number;
  etaFinishPlanIso: string;
};

function frozenElapsedAt(
  baselineTrack: RaceCourseBaselineTrack | undefined,
  distanceMeters: number,
  plannedPaceSecondsPerKm: number,
  courseLengthMeters: number
): number {
  if (
    baselineTrack &&
    baselineTrack.points.length >= 2 &&
    baselineTrack.points[0]!.distanceMetersFromStart <= 0.05 &&
    baselineTrack.points[baselineTrack.points.length - 1]!.distanceMetersFromStart + 0.05 >=
      courseLengthMeters
  ) {
    return interpolateElapsedAtDistance(
      baselineTrack.points.map((p) => ({
        distanceMetersFromStart: p.distanceMetersFromStart,
        referenceElapsedSeconds: p.referenceElapsedSeconds
      })),
      distanceMeters
    );
  }
  return (distanceMeters / 1000) * plannedPaceSecondsPerKm;
}

/**
 * Re-simulate remaining course (expected scenario) from current progress.
 * Frozen plan times come from baselineTrack (plan of record at race start).
 */
export function computeLiveRemainingProjection(input: {
  routeMetricPoints: CourseMetricPoint[];
  checkpoints: RaceCourseCheckpoint[];
  courseLengthMeters: number;
  progressMeters: number;
  actualElapsedSeconds: number;
  raceStartAtIso: string;
  recordedAtIso: string;
  plannedPaceSecondsPerKm: number;
  frozenBaselineTrack?: RaceCourseBaselineTrack;
  /** Optional prebuilt profile; otherwise cold-start defaults. */
  profile?: RunnerProfile;
  remainingPlannedStoppageSecondsAhead?: number;
}): LiveRemainingProjection {
  const segments = buildCourseMicroSegments(input.routeMetricPoints);
  const profile =
    input.profile ??
    buildRunnerProfile({ history: [], courseDistanceMeters: input.courseLengthMeters });

  const fatigue = fatigueStateAtProgress({
    segments,
    profile,
    progressMeters: input.progressMeters
  });

  const sims = runScenarioSims({
    segments,
    profile,
    fromDistanceMeters: input.progressMeters,
    initialStateForRemaining: {
      workCum: fatigue.workCum,
      descentCum: fatigue.descentCum,
      actualElapsedSeconds: input.actualElapsedSeconds
    }
  });

  const remaining: RemainingCheckpointEta[] = [];
  for (const cp of input.checkpoints) {
    const d = cp.distanceMetersFromStart;
    if (typeof d !== "number" || !Number.isFinite(d)) {
      continue;
    }
    if (d <= input.progressMeters + 0.5) {
      continue;
    }
    const liveProjectedElapsedSeconds = Math.max(
      0,
      Math.round(interpolateElapsedAtDistance(sims.expected.distanceElapsedCurve, d))
    );
    const frozenPlanElapsedSeconds = Math.max(
      0,
      Math.round(
        frozenElapsedAt(
          input.frozenBaselineTrack,
          d,
          input.plannedPaceSecondsPerKm,
          input.courseLengthMeters
        )
      )
    );
    remaining.push({
      checkpointId: cp.id,
      liveProjectedElapsedSeconds,
      frozenPlanElapsedSeconds,
      deltaSecondsVsFrozenPlan: liveProjectedElapsedSeconds - frozenPlanElapsedSeconds
    });
  }

  const finishElapsed = Math.max(
    0,
    Math.round(
      interpolateElapsedAtDistance(sims.expected.distanceElapsedCurve, input.courseLengthMeters)
    )
  );
  const stoppagePad = Math.max(0, input.remainingPlannedStoppageSecondsAhead ?? 0);
  const etaFinishElapsedSeconds = finishElapsed + stoppagePad;
  const raceStartMs = Date.parse(input.raceStartAtIso);
  const etaFinishPlanIso = new Date(raceStartMs + etaFinishElapsedSeconds * 1000).toISOString();

  return { remainingCheckpointEtas: remaining, etaFinishElapsedSeconds, etaFinishPlanIso };
}
