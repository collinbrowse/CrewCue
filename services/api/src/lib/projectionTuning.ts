/**
 * Provisional pace-model and live-projection constants from the Nov 3–4 2026 backtest, and the flag
 * that gates them.
 *
 * The backtest fit these on race results, 5 of 6 courses from OpenSplitTime, which granted
 * permission on Nov 5 2026; a re-check on OpenSplitTime data alone confirmed them. Everything here
 * still runs only with `PROJECTION_TUNED_CONSTANTS` on, so production changes only when an operator
 * turns it on. Off keeps today's estimate and ETA path exactly.
 * Numbers and the data behind them: microModel/CONSTANTS_FOR_APPROVAL.md.
 */

/** Read at call time so tests (and an operator) can switch it without a restart. */
export function isProjectionTunedConstantsEnabled(): boolean {
  const raw = process.env.PROJECTION_TUNED_CONSTANTS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

/** Late-race slowdown: section time × (1 + s·(progress − 0.5)), renormalized to the same total. */
export const SLOWDOWN_SLOPE_DEFAULT = 0.24;

/** Moving-time multiplier while the sun is below −6° (civil twilight) at the course start. */
export const NIGHT_PACE_FACTOR = 1.06;
export const NIGHT_SUN_ELEVATION_DEGREES = -6;

/**
 * Expected log-error of a pre-race plan's finish time, by how the runner profile was built.
 * Provisional; PR 6 replaces them with values measured from finished rooms.
 */
export const PLAN_LOG_SIGMA = {
  coldStart: 0.3,
  coarseHistory: 0.2,
  similarHistory: 0.12
} as const;
/** A plan that doesn't record its σ is treated as this (gives the earlier fixed trust 0.3). */
export const PLAN_LOG_SIGMA_DEFAULT = 0.12;

/** Live ratio: recency weight halves every this many meters of course covered. */
export const LIVE_RATIO_HALF_LIFE_METERS = 40_000;
/** trust = LIVE_TRUST_VARIANCE / σ²; then w = seen / (seen + trust). */
export const LIVE_TRUST_VARIANCE = 0.0043;
/** Below this much planned moving time covered, the live ratio is not yet meaningful. */
export const LIVE_RATIO_MIN_PLAN_SECONDS = 120;

/** Progress-bias correction: r_rem = r · exp(A + B·seen + C·clamp(ln ratio, ±1)·(1 − w)). */
export const LIVE_BIAS_A = 0.09;
export const LIVE_BIAS_B = -0.21;
export const LIVE_BIAS_C = 0.36;

/** Runner's stop habit: (K_STOP + Σ actual/planned) / (K_STOP + n) over planned stops passed. */
export const K_STOP = 2;
