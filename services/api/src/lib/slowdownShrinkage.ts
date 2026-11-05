/**
 * Combines a runner's measured slowdowns into one number (plan PR 6). Kept apart from the
 * measurement (runnerSlowdown.ts) so the runner profile can use it without importing the
 * micro-model it is part of.
 */
import { SLOWDOWN_SLOPE_DEFAULT } from "./projectionTuning.js";

/** Efforts shorter than this say little about late-race slowdown. */
export const SLOWDOWN_MIN_EFFORT_METERS = 30_000;
/** Shrinkage strength, in race-equivalents of the population default. */
export const SLOWDOWN_SHRINK_K = 2;
/** A race this long counts as one full race-equivalent; shorter ones count proportionally. */
export const SLOWDOWN_FULL_WEIGHT_METERS = 80_000;
export const SLOWDOWN_SLOPE_RANGE = { min: 0, max: 0.6 } as const;

export type SlowdownObservation = { slope: number; distanceMeters: number };

/**
 * The runner's slowdown: (K·default + Σ wᵢ·sᵢ) / (K + Σ wᵢ), wᵢ = min(1, distanceᵢ / 80 km),
 * clamped to [0, 0.6]. Observations under SLOWDOWN_MIN_EFFORT_METERS are ignored.
 */
export function personalSlowdownSlope(observations: readonly SlowdownObservation[]): { slope: number; basedOn: number } {
  const usable = observations.filter(
    (o) => Number.isFinite(o.slope) && o.distanceMeters >= SLOWDOWN_MIN_EFFORT_METERS
  );
  let num = SLOWDOWN_SHRINK_K * SLOWDOWN_SLOPE_DEFAULT;
  let den = SLOWDOWN_SHRINK_K;
  for (const o of usable) {
    const w = Math.min(1, o.distanceMeters / SLOWDOWN_FULL_WEIGHT_METERS);
    num += w * o.slope;
    den += w;
  }
  const slope = Math.min(SLOWDOWN_SLOPE_RANGE.max, Math.max(SLOWDOWN_SLOPE_RANGE.min, num / den));
  return { slope, basedOn: usable.length };
}

