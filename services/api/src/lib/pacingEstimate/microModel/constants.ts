/**
 * Physiology micro-model constants (proposed for product approval).
 *
 * Cold-start grade-adjusted pace: 10:00 per mile.
 * Surface complexity C_i is fixed at 1.0 until a reliable map surface source exists.
 *
 * Scenario bands are three deterministic re-sims (not finish-time ratio stretch).
 */

/** Grade-adjusted baseline pace when no usable history (seconds per mile). */
export const COLD_START_GAP_SECONDS_PER_MILE = 600;

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_KILOMETER = 1000;

/** Target micro-segment length along the route (meters). */
export const MICRO_SEGMENT_TARGET_METERS = 100;

/** Surface complexity — always 1 until a better data source exists. */
export const SURFACE_COMPLEXITY = 1;

/**
 * Altitude oxygen factor: F_alt ≈ 1 - 0.01 × (Alt − 1500) / 300 for Alt > 1500 m.
 * Below 1500 m, F_alt = 1.
 */
export const ALTITUDE_PENALTY_START_METERS = 1500;
export const ALTITUDE_PENALTY_PER_300M = 0.01;

/** Technical downhill grade threshold (rise/run); steeper than this adds a braking penalty. */
export const TECHNICAL_DOWNHILL_GRADE = -0.15;
/** Extra cost multiplier on top of M(g) when grade < TECHNICAL_DOWNHILL_GRADE. */
export const TECHNICAL_DOWNHILL_EXTRA = 1.12;

/**
 * Default terrain efficiency E(g) = 1 (no athlete-specific fit; training summaries only).
 * Kept as a function for future profile injection.
 */
export const DEFAULT_TERRAIN_EFFICIENCY = 1;

/**
 * Fatigue: P = P0 × (1 + γ1 · W_cum + γ2 · D_down).
 * W_cum accumulates relative energy cost × distance (m); D_down accumulates descent impact (m).
 * Tuned so a 50 km / ~1500 m gain effort adds on the order of ~8–12% late-race slowdown.
 */
export const FATIGUE_GAMMA1_PER_METER_WORK = 2.5e-7;
export const FATIGUE_GAMMA2_PER_METER_DESCENT = 4e-5;

/**
 * Scenario knob deltas applied to fatigue + base GAP for conservative / aggressive re-sims.
 * Expected uses nominal coefficients.
 */
export const SCENARIO_CONSERVATIVE = {
  gapMultiplier: 1.06,
  gamma1Multiplier: 1.35,
  gamma2Multiplier: 1.4,
  altitudePenaltyMultiplier: 1.15
} as const;

export const SCENARIO_AGGRESSIVE = {
  gapMultiplier: 0.94,
  gamma1Multiplier: 0.75,
  gamma2Multiplier: 0.7,
  altitudePenaltyMultiplier: 0.9
} as const;

export const SCENARIO_EXPECTED = {
  gapMultiplier: 1,
  gamma1Multiplier: 1,
  gamma2Multiplier: 1,
  altitudePenaltyMultiplier: 1
} as const;

/** Keep history whose distance is within this fraction of course distance. */
export const HISTORY_SIMILARITY_MIN_RATIO = 0.02;
export const HISTORY_SIMILARITY_MAX_RATIO = 2.0;
/** Absolute floor so tiny GPS scraps never feed GAP (~3.1 mi). */
export const HISTORY_SIMILARITY_MIN_DISTANCE_METERS = 5000;
/**
 * When any candidate is at least this long, prefer those rows over shorter weekday runs.
 * If nothing reaches this length, use the full wide window (100–250 mi plans still get training pace).
 */
export const HISTORY_SIMILARITY_PREFER_MIN_DISTANCE_METERS = 20_000;
