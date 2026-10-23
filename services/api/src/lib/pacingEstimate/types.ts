/**
 * Pacing estimate port + inputs (W3-3).
 * Implementations must be deterministic for a given seed + inputs (no live LLM in CI).
 */
import type { ActivityHistoryRef, PacingEstimate, RaceCourseCheckpoint } from "@crewcue/contracts";

/** Fixed CI seed so fixture tests never depend on wall clock or RNG. */
export const DEFAULT_PACING_ESTIMATE_SEED = "crewcue-pacing-v1";

export type PacingEstimateInput = {
  /** Official race start (ISO-8601 UTC). */
  raceStartAt: string;
  /** Ordered course checkpoints; distances from start required (meters). */
  checkpoints: RaceCourseCheckpoint[];
  /** Athlete history rows (may be empty → cold-start). */
  history: ActivityHistoryRef[];
  /** Determinism seed; defaults to {@link DEFAULT_PACING_ESTIMATE_SEED}. */
  seed?: string;
};

/**
 * Pluggable estimator. Swap for an LLM/provider later without flaking CI
 * (tests always inject the deterministic fixture implementation).
 */
export interface PacingEstimator {
  estimate(input: PacingEstimateInput): PacingEstimate;
}

export type PacingEstimateCourseErrorCode =
  | "course_missing"
  | "course_incomplete"
  | "course_distance_missing"
  | "race_start_invalid";

export class PacingEstimateCourseError extends Error {
  readonly code: PacingEstimateCourseErrorCode;

  constructor(code: PacingEstimateCourseErrorCode, message: string) {
    super(message);
    this.name = "PacingEstimateCourseError";
    this.code = code;
  }
}
