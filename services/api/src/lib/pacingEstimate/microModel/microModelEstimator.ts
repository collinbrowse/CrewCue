/**
 * Physiology micro-model pacing estimator (plan-of-record moving times + scenario bands).
 */
import { createHash } from "node:crypto";
import {
  parseIso8601Utc,
  parsePacingEstimate,
  type PacingAidEta,
  type PacingEstimate,
  type RaceCourseBaselineTrack,
  type RaceCourseCheckpoint
} from "@crewcue/contracts";
import type { CourseMetricPoint } from "@crewcue/map-core";
import {
  DEFAULT_PACING_ESTIMATE_SEED,
  PacingEstimateCourseError,
  type PacingEstimateInput,
  type PacingEstimator
} from "../types.js";
import { buildCourseMicroSegments, type CourseMicroSegment } from "./courseMesh.js";
import { buildRunnerProfile, type RunnerProfile } from "./runnerProfile.js";
import { interpolateElapsedAtDistance, type NightContext } from "./simulate.js";
import { isProjectionTunedConstantsEnabled } from "../../projectionTuning.js";
import { cohortIsUsable, cohortPlanElapsed, reshapeCurve, type Cohort } from "../../courseHistory/cohort.js";
import {
  baselineTrackFromSimulation,
  elapsedAtCheckpoints,
  fatigueStateAtProgress,
  runScenarioSims
} from "./scenarios.js";

export type MicroModelEstimateInput = PacingEstimateInput & {
  /** Past finishers of the linked course (25+); reshapes the plan between checkpoints. */
  courseHistoryCohort?: Cohort;
  /** The runner's slowdown from CrewCue races they finished. */
  slowdownObservations?: Array<{ slope: number; distanceMeters: number }>;
  /** Measured plan σ per profile branch (only branches with enough finished rooms). */
  planLogSigmaByBranch?: Partial<Record<"coldStart" | "coarseHistory" | "similarHistory", number>>;
  /** Dense course route (required for micro-segments). */
  routeMetricPoints: CourseMetricPoint[];
  /** Optional canonical length override. */
  courseLengthMeters?: number;
};

export type MicroModelEstimateArtifacts = {
  estimate: PacingEstimate;
  baselineTrack: RaceCourseBaselineTrack;
  segments: CourseMicroSegment[];
  profile: RunnerProfile;
  courseLengthMeters: number;
};

function roundElapsed(seconds: number): number {
  return Math.max(0, Math.round(seconds));
}

function clockAt(raceStartAt: string, elapsedSeconds: number): string {
  return new Date(Date.parse(raceStartAt) + elapsedSeconds * 1000).toISOString();
}

function courseDistanceFromCheckpoints(checkpoints: RaceCourseCheckpoint[]): number {
  let max = 0;
  for (const cp of checkpoints) {
    const d = cp.distanceMetersFromStart;
    if (typeof d === "number" && Number.isFinite(d) && d > max) {
      max = d;
    }
  }
  return max;
}

function assertValidCourse(input: MicroModelEstimateInput): {
  raceStartAt: string;
  checkpoints: RaceCourseCheckpoint[];
  courseDistance: number;
} {
  if (!Array.isArray(input.checkpoints) || input.checkpoints.length === 0) {
    throw new PacingEstimateCourseError("course_missing", "Course checkpoints are required");
  }
  if (input.checkpoints.length < 2) {
    throw new PacingEstimateCourseError(
      "course_incomplete",
      "Course must include at least two checkpoints"
    );
  }
  if (!Array.isArray(input.routeMetricPoints) || input.routeMetricPoints.length < 2) {
    throw new PacingEstimateCourseError(
      "course_incomplete",
      "Course route geometry (polyline) is required for micro-model pacing"
    );
  }

  let raceStartAt: string;
  try {
    raceStartAt = parseIso8601Utc(input.raceStartAt, "raceStartAt");
  } catch {
    throw new PacingEstimateCourseError(
      "race_start_invalid",
      "raceStartAt must be an ISO-8601 UTC string"
    );
  }

  for (const [index, cp] of input.checkpoints.entries()) {
    if (!cp || typeof cp.id !== "string" || cp.id.length === 0) {
      throw new PacingEstimateCourseError(
        "course_incomplete",
        `checkpoints[${index}].id is required`
      );
    }
    const d = cp.distanceMetersFromStart;
    if (typeof d !== "number" || !Number.isFinite(d) || d < 0) {
      throw new PacingEstimateCourseError(
        "course_distance_missing",
        `checkpoints[${index}].distanceMetersFromStart must be a non-negative finite number`
      );
    }
  }

  const fromCp = courseDistanceFromCheckpoints(input.checkpoints);
  const courseDistance =
    typeof input.courseLengthMeters === "number" && input.courseLengthMeters > 0
      ? input.courseLengthMeters
      : fromCp;
  if (!(courseDistance > 0)) {
    throw new PacingEstimateCourseError(
      "course_distance_missing",
      "Course distance must be greater than zero"
    );
  }

  return { raceStartAt, checkpoints: input.checkpoints, courseDistance };
}

function isAidLike(cp: RaceCourseCheckpoint): boolean {
  if (cp.tags?.includes("aid")) {
    return true;
  }
  const id = cp.id.toLowerCase();
  const title = (cp.title ?? "").toLowerCase();
  if (id === "start" || id === "finish" || title === "start" || title === "finish") {
    return false;
  }
  return /\baid\b/.test(id) || id.startsWith("aid") || /\baid\b/.test(title);
}

/**
 * Mid-course checkpoints that should get an aid ETA. Prefer explicitly aid-tagged/named stops.
 * PR D (#484): the old fallback emitted an ETA for *every* mid-course checkpoint, fabricating aid
 * arrivals for arbitrary markers (summit, gate). Tighten the fallback to checkpoints that carry a
 * planned stop (`plannedStopSeconds > 0`) — a real crew/aid stop — and otherwise emit none.
 */
function selectAidCheckpoints(
  checkpoints: RaceCourseCheckpoint[],
  courseDistance: number
): RaceCourseCheckpoint[] {
  const midCourse = checkpoints.filter((cp) => {
    const d = cp.distanceMetersFromStart ?? 0;
    return d > 0 && d < courseDistance;
  });
  const taggedOrNamed = midCourse.filter(isAidLike);
  if (taggedOrNamed.length > 0) {
    return taggedOrNamed;
  }
  return midCourse.filter((cp) => (cp.plannedStopSeconds ?? 0) > 0);
}

function buildEstimateId(parts: {
  seed: string;
  raceStartAt: string;
  courseDistance: number;
  finishElapsed: number;
  coldStart: boolean;
  historyRefIds: string[];
  aidCheckpointIds: string[];
}): string {
  const payload = [
    "micro-v1",
    parts.seed,
    parts.raceStartAt,
    String(Math.round(parts.courseDistance * 1000) / 1000),
    String(parts.finishElapsed),
    parts.coldStart ? "1" : "0",
    parts.historyRefIds.join(","),
    parts.aidCheckpointIds.join(",")
  ].join("|");
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return `est_${digest}`;
}

export function estimatePacingMicroModelWithArtifacts(
  input: MicroModelEstimateInput
): MicroModelEstimateArtifacts {
  const { raceStartAt, checkpoints, courseDistance } = assertValidCourse(input);
  const seed = input.seed ?? DEFAULT_PACING_ESTIMATE_SEED;
  const segments = buildCourseMicroSegments(input.routeMetricPoints);
  if (segments.length < 1) {
    throw new PacingEstimateCourseError(
      "course_incomplete",
      "Could not build course micro-segments from route geometry"
    );
  }

  const profile = buildRunnerProfile({
    history: Array.isArray(input.history) ? input.history : [],
    courseDistanceMeters: courseDistance,
    ...(input.slowdownObservations ? { slowdownObservations: input.slowdownObservations } : {}),
    ...(input.planLogSigmaByBranch ? { planLogSigmaByBranch: input.planLogSigmaByBranch } : {})
  });

  const tuned = isProjectionTunedConstantsEnabled();
  const start = input.routeMetricPoints[0]!;
  const night: NightContext | undefined = tuned
    ? { raceStartMs: Date.parse(raceStartAt), latitude: start.latitude, longitude: start.longitude }
    : undefined;
  let sims = runScenarioSims({
    segments,
    profile,
    courseLengthMeters: courseDistance,
    ...(night ? { night } : {})
  });
  // Course history: checkpoint times follow past finishers of similar planned finish; the GPX curve
  // keeps its shape between checkpoints. Tuned constants only (the 25-finisher threshold and the
  // ±10% band come from the Nov 2026 backtest).
  const cohort = tuned && input.courseHistoryCohort && cohortIsUsable(input.courseHistoryCohort) ? input.courseHistoryCohort : undefined;
  if (cohort) {
    const plannedFinish = interpolateFinish(sims.expected, courseDistance, checkpoints);
    const distanceOf = new Map(checkpoints.map((cp) => [cp.id, cp.distanceMetersFromStart as number]));
    const elapsed = cohortPlanElapsed(cohort, plannedFinish);
    const anchors = cohort.checkpointIds.map((id, i) => ({ distanceMeters: distanceOf.get(id) ?? 0, elapsedSeconds: elapsed[i]! }));
    sims.expected = { ...sims.expected, distanceElapsedCurve: reshapeCurve(sims.expected.distanceElapsedCurve, anchors) };
  }
  const expectedElapsedByCp = elapsedAtCheckpoints(sims.expected, checkpoints);
  const finishElapsed = roundElapsed(
    interpolateFinish(sims.expected, courseDistance, checkpoints)
  );
  const conservativeFinish = roundElapsed(
    interpolateFinish(sims.conservative, courseDistance, checkpoints)
  );
  const aggressiveFinish = roundElapsed(
    interpolateFinish(sims.aggressive, courseDistance, checkpoints)
  );

  // Band ordering: conservative ≥ expected ≥ aggressive
  const conservativeOrdered = Math.max(conservativeFinish, finishElapsed);
  const aggressiveOrdered = Math.min(aggressiveFinish, finishElapsed);

  const aids = selectAidCheckpoints(checkpoints, courseDistance);
  const aidEtas: PacingAidEta[] = aids.map((cp) => {
    const elapsedSeconds = expectedElapsedByCp.get(cp.id) ?? roundElapsed(
      (cp.distanceMetersFromStart as number) * profile.gapSecondsPerMeter * profile.enduranceFactor
    );
    return {
      checkpointId: cp.id,
      clockArrivalAt: clockAt(raceStartAt, elapsedSeconds),
      elapsedSeconds
    };
  });

  const candidate: PacingEstimate = {
    id: buildEstimateId({
      seed,
      raceStartAt,
      courseDistance,
      finishElapsed,
      coldStart: profile.coldStart,
      historyRefIds: profile.historyRefIds ?? [],
      aidCheckpointIds: aids.map((a) => a.id)
    }),
    coldStart: profile.coldStart,
    expectedFinishAt: clockAt(raceStartAt, finishElapsed),
    expectedFinishElapsedSeconds: finishElapsed,
    aidEtas,
    bands: {
      conservative: {
        finishAt: clockAt(raceStartAt, conservativeOrdered),
        finishElapsedSeconds: conservativeOrdered
      },
      expected: {
        finishAt: clockAt(raceStartAt, finishElapsed),
        finishElapsedSeconds: finishElapsed
      },
      aggressive: {
        finishAt: clockAt(raceStartAt, aggressiveOrdered),
        finishElapsedSeconds: aggressiveOrdered
      }
    },
    explanation: `${profile.explanation} Bands from three micro-model scenario re-sims (not fixed finish ratios).${
      cohort ? ` Checkpoint times follow ${cohort.arrivals.length} past finishers of this course.` : ""
    }`,
    ...(profile.historyRefIds !== undefined ? { historyRefIds: profile.historyRefIds } : {})
  };

  return {
    estimate: parsePacingEstimate(candidate),
    baselineTrack: baselineTrackFromSimulation(
      sims.expected,
      tuned ? profile.planLogSigma : undefined,
      tuned ? profile.planBranch : undefined
    ),
    segments,
    profile,
    courseLengthMeters: courseDistance
  };
}

/**
 * Distance of the farthest checkpoint. A loop or out-and-back often has an earlier
 * waypoint whose id is exactly `finish` (the first pass of the finish line, then
 * `finish-2` at the return). That first id is not the end of the course.
 */
function farthestCheckpointDistance(checkpoints: readonly RaceCourseCheckpoint[]): number | undefined {
  let best = -1;
  for (const cp of checkpoints) {
    const d = cp.distanceMetersFromStart;
    if (typeof d === "number" && Number.isFinite(d) && d >= best) {
      best = d;
    }
  }
  return best >= 0 ? best : undefined;
}

function interpolateFinish(
  sim: { distanceElapsedCurve: Array<{ distanceMetersFromStart: number; referenceElapsedSeconds: number }> },
  courseDistance: number,
  checkpoints: RaceCourseCheckpoint[]
): number {
  const farthest = farthestCheckpointDistance(checkpoints);
  const d = farthest !== undefined && farthest > 0 ? farthest : courseDistance;
  return interpolateElapsedAtDistance(sim.distanceElapsedCurve, d);
}

/** PacingEstimator adapter (drops baseline artifacts). Prefer estimatePacingMicroModelWithArtifacts. */
export function estimatePacingMicroModel(input: MicroModelEstimateInput): PacingEstimate {
  return estimatePacingMicroModelWithArtifacts(input).estimate;
}

export const microModelPacingEstimator: PacingEstimator & {
  estimateWithArtifacts: (input: MicroModelEstimateInput) => MicroModelEstimateArtifacts;
} = {
  estimate(input: PacingEstimateInput): PacingEstimate {
    const extended = input as MicroModelEstimateInput;
    if (!extended.routeMetricPoints || extended.routeMetricPoints.length < 2) {
      throw new PacingEstimateCourseError(
        "course_incomplete",
        "Course route geometry (polyline) is required for micro-model pacing"
      );
    }
    return estimatePacingMicroModel(extended);
  },
  estimateWithArtifacts: estimatePacingMicroModelWithArtifacts
};

export { fatigueStateAtProgress, runScenarioSims, buildCourseMicroSegments, buildRunnerProfile };
