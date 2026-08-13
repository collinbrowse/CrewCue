/**
 * Deterministic, fixture-friendly pacing estimator (W3-3).
 * History pace → finish + aid ETAs. Empty history → cold-start coarse pace (no throw).
 */
import { createHash } from "node:crypto";
import {
  parseIso8601Utc,
  parsePacingEstimate,
  type ActivityHistoryRef,
  type PacingAidEta,
  type PacingEstimate,
  type RaceCourseCheckpoint
} from "@crewcue/contracts";
import {
  DEFAULT_PACING_ESTIMATE_SEED,
  PacingEstimateCourseError,
  type PacingEstimateInput,
  type PacingEstimator
} from "./types.js";

/** Coarse ultra trail pace when no usable history (7:00 / km). */
const COLD_START_SECONDS_PER_KM = 420;

/** Keep history whose distance is within this fraction of course distance. */
const SIMILARITY_MIN_RATIO = 0.4;
const SIMILARITY_MAX_RATIO = 1.5;

/**
 * Confidence / A-B band spread policy (W4-2 / #411).
 *
 * Not UltraPacer strategy knobs — deterministic elapsed multipliers around the
 * primary (expected) finish only:
 * - conservative = round(expectedElapsed × {@link PACING_BAND_CONSERVATIVE_RATIO})
 * - expected     = primary finish (same as `expectedFinishElapsedSeconds`)
 * - aggressive   = round(expectedElapsed × {@link PACING_BAND_AGGRESSIVE_RATIO})
 *
 * Ordering invariant: conservative ≥ expected ≥ aggressive (elapsed seconds).
 * Cold-start uses the **same** ratios; bands stay coarse because the expected
 * finish itself is course-only (see `fixtures/pacing/estimate-bands.json`).
 */
export const PACING_BAND_CONSERVATIVE_RATIO = 1.15;
export const PACING_BAND_AGGRESSIVE_RATIO = 0.885;

function roundElapsed(seconds: number): number {
  return Math.max(0, Math.round(seconds));
}

function clockAt(raceStartAt: string, elapsedSeconds: number): string {
  return new Date(Date.parse(raceStartAt) + elapsedSeconds * 1000).toISOString();
}

function courseDistanceMeters(checkpoints: RaceCourseCheckpoint[]): number {
  let max = 0;
  for (const cp of checkpoints) {
    const d = cp.distanceMetersFromStart;
    if (typeof d === "number" && Number.isFinite(d) && d > max) {
      max = d;
    }
  }
  return max;
}

function assertValidCourse(input: PacingEstimateInput): {
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

  const courseDistance = courseDistanceMeters(input.checkpoints);
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

function selectAidCheckpoints(
  checkpoints: RaceCourseCheckpoint[],
  courseDistance: number
): RaceCourseCheckpoint[] {
  const midCourse = checkpoints.filter((cp) => {
    const d = cp.distanceMetersFromStart ?? 0;
    return d > 0 && d < courseDistance;
  });
  const taggedOrNamed = midCourse.filter(isAidLike);
  return taggedOrNamed.length > 0 ? taggedOrNamed : midCourse;
}

function usableHistory(history: ActivityHistoryRef[]): ActivityHistoryRef[] {
  return history.filter(
    (row) =>
      typeof row.distanceMeters === "number" &&
      row.distanceMeters > 0 &&
      typeof row.elapsedSeconds === "number" &&
      row.elapsedSeconds > 0
  );
}

function similarHistory(
  usable: ActivityHistoryRef[],
  courseDistance: number
): ActivityHistoryRef[] {
  return usable.filter((row) => {
    const ratio = (row.distanceMeters as number) / courseDistance;
    return ratio >= SIMILARITY_MIN_RATIO && ratio <= SIMILARITY_MAX_RATIO;
  });
}

/** Mean seconds-per-meter from selected history (equal weight per activity). */
function meanSecondsPerMeter(selected: ActivityHistoryRef[]): number {
  let sum = 0;
  for (const row of selected) {
    sum += (row.elapsedSeconds as number) / (row.distanceMeters as number);
  }
  return sum / selected.length;
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

function buildAidEtas(
  aids: RaceCourseCheckpoint[],
  raceStartAt: string,
  secondsPerMeter: number
): PacingAidEta[] {
  return aids.map((cp) => {
    const elapsedSeconds = roundElapsed((cp.distanceMetersFromStart as number) * secondsPerMeter);
    return {
      checkpointId: cp.id,
      clockArrivalAt: clockAt(raceStartAt, elapsedSeconds),
      elapsedSeconds
    };
  });
}

/**
 * Pure deterministic estimator. Same inputs + seed → identical {@link PacingEstimate}.
 */
export function estimatePacingDeterministic(input: PacingEstimateInput): PacingEstimate {
  const { raceStartAt, checkpoints, courseDistance } = assertValidCourse(input);
  const seed = input.seed ?? DEFAULT_PACING_ESTIMATE_SEED;
  const aids = selectAidCheckpoints(checkpoints, courseDistance);

  const history = Array.isArray(input.history) ? input.history : [];
  const usable = usableHistory(history);
  const similar = similarHistory(usable, courseDistance);

  let coldStart = false;
  let secondsPerMeter: number;
  let historyRefIds: string[] | undefined;
  let explanation: string;

  if (usable.length === 0) {
    coldStart = true;
    secondsPerMeter = COLD_START_SECONDS_PER_KM / 1000;
    explanation =
      "No usable activity history; coarse course-only estimate (cold start). Upload similar GPX or connect history for a tighter plan.";
  } else if (similar.length > 0) {
    secondsPerMeter = meanSecondsPerMeter(similar);
    historyRefIds = similar.map((row) => row.id);
    const excluded = usable.length - similar.length;
    explanation =
      excluded > 0
        ? `History-backed from ${similar.length} similar activit${similar.length === 1 ? "y" : "ies"}; ${excluded} dissimilar excluded.`
        : `History-backed from ${similar.length} activit${similar.length === 1 ? "y" : "ies"}.`;
  } else {
    // Usable but all dissimilar — still produce an estimate (no throw); note coarseness.
    secondsPerMeter = meanSecondsPerMeter(usable);
    historyRefIds = usable.map((row) => row.id);
    explanation = `History present but dissimilar to course distance; estimate uses available pace (coarse).`;
  }

  const finishElapsed = roundElapsed(courseDistance * secondsPerMeter);
  const conservativeElapsed = roundElapsed(finishElapsed * PACING_BAND_CONSERVATIVE_RATIO);
  const aggressiveElapsed = roundElapsed(finishElapsed * PACING_BAND_AGGRESSIVE_RATIO);
  const aidEtas = buildAidEtas(aids, raceStartAt, secondsPerMeter);

  const candidate: PacingEstimate = {
    id: buildEstimateId({
      seed,
      raceStartAt,
      courseDistance,
      finishElapsed,
      coldStart,
      historyRefIds: historyRefIds ?? [],
      aidCheckpointIds: aids.map((a) => a.id)
    }),
    coldStart,
    expectedFinishAt: clockAt(raceStartAt, finishElapsed),
    expectedFinishElapsedSeconds: finishElapsed,
    aidEtas,
    bands: {
      conservative: {
        finishAt: clockAt(raceStartAt, conservativeElapsed),
        finishElapsedSeconds: conservativeElapsed
      },
      expected: {
        finishAt: clockAt(raceStartAt, finishElapsed),
        finishElapsedSeconds: finishElapsed
      },
      aggressive: {
        finishAt: clockAt(raceStartAt, aggressiveElapsed),
        finishElapsedSeconds: aggressiveElapsed
      }
    },
    explanation,
    ...(historyRefIds !== undefined ? { historyRefIds } : {})
  };

  return parsePacingEstimate(candidate);
}

export const deterministicPacingEstimator: PacingEstimator = {
  estimate: estimatePacingDeterministic
};
