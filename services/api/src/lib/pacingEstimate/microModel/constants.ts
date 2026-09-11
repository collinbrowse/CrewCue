/**
 * Physiology micro-model constants (proposed for product approval).
 *
 * Cold-start grade-adjusted pace: 10:00 per mile (true flat GAP).
 * History-backed estimates treat summary pace as already trail-inclusive and only
 * apply a fraction of grade/altitude cost (avoids double-counting hills).
 *
 * Scenario bands are three deterministic re-sims (not finish-time ratio stretch).
 */

/** Grade-adjusted baseline pace when no usable history (seconds per mile). */
export const COLD_START_GAP_SECONDS_PER_MILE = 600;

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_KILOMETER = 1000;

/** Target micro-segment length along the route (meters). */
export const MICRO_SEGMENT_TARGET_METERS = 100;

/** Surface complexity — always 1 until a reliable map surface source exists. */
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
export const TECHNICAL_DOWNHILL_EXTRA = 1.08;

/**
 * Restored physiological relative grade cost M(g) = cost(g)/cost(flat), g = rise/run.
 * Separate uphill/downhill quadratics (running is asymmetric): uphill costs rise steeply,
 * shallow downhill is cheaper than flat (energy return) before eccentric braking dominates.
 *
 *   uphill  (g ≥ 0): 1 + 1.7·g + 13·g²   → +12% @5%, +30% @10%, +55% @15%
 *   downhill (g < 0): 1 + 2.4·g + 12·g²  → ~0.88 min near −10%, back to ~1 by −20%
 *
 * C1 removes the athlete's own training terrain from GAP (flat-equivalent), so the full model is
 * applied on the course (blend 1.0) without double-counting — see #483 / pacing-accuracy-program.md.
 */
export const MINETTI_UPHILL_LINEAR = 1.7;
export const MINETTI_UPHILL_QUADRATIC = 13;
export const MINETTI_DOWNHILL_LINEAR = 2.4;
export const MINETTI_DOWNHILL_QUADRATIC = 12;
/** Floor on the relative grade cost (very steep downhill never becomes free). */
export const GRADE_COST_MIN_MULTIPLIER = 0.7;

/**
 * How much of the grade/altitude cost model to apply beyond the baseline pace.
 * Both are 1.0 (full model): C1 derives a flat-equivalent GAP from summary distance + gain, so the
 * course grade/altitude model no longer double-counts terrain baked into history pace. The blend
 * plumbing is retained for a future athlete-specific slope-efficiency E(g).
 */
export const GRADE_COST_BLEND_COLD_START = 1.0;
export const GRADE_COST_BLEND_HISTORY = 1.0;

/**
 * C1 — flat-equivalent GAP from summary elevation. Treat each meter of climb in a history summary
 * as this many meters of flat-equivalent distance, so the athlete's baseline pace is decoupled from
 * the terrain of the runs it was measured on: flatEquivPace = Σ elapsed / Σ (distance + c·gain).
 * ≈ average (M(g)−1)/g over typical 8–12% climbs; provisional pending field re-derivation.
 */
export const GAIN_FLAT_EQUIVALENT_METERS_PER_METER = 4.0;

/**
 * C2 — Riegel endurance scaling. Predicted time T2 = T1·(D2/D1)^k, so the pace factor over a course
 * longer than the athlete's reference distance is (D_course/D_ref)^(k−1). This exponent is (k−1);
 * 0.19 gives ≈1.5× at 100 mi from a 20 km reference (the textbook 1.06 → only ~1.13× is too small
 * now that fatigue is shape-only). Only scales up (never predicts faster than the reference pace).
 */
export const RIEGEL_ENDURANCE_PACE_EXPONENT = 0.19;

/**
 * Default terrain efficiency E(g) = 1 (no athlete-specific fit; training summaries only).
 * Kept as a function for future profile injection.
 */
export const DEFAULT_TERRAIN_EFFICIENCY = 1;

/**
 * Fatigue SHAPE: P ∝ (1 + γ1 · W_cum + γ2 · D_down). C3 renormalizes this across the course so it
 * only redistributes the endurance-scaled total (later segments slower, earlier faster) and does
 * NOT inflate the finish time — endurance (C2) owns the total, γ owns the shape, M(g) owns terrain.
 * W_cum accumulates relative energy cost × distance (m); D_down accumulates descent impact (m).
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
