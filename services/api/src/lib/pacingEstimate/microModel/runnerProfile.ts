/**
 * Runner profile for micro-model (defaults + optional summary-based GAP).
 */
import type { ActivityHistoryRef } from "@crewcue/contracts";
import {
  COLD_START_GAP_SECONDS_PER_MILE,
  DEFAULT_TERRAIN_EFFICIENCY,
  FATIGUE_GAMMA1_PER_METER_WORK,
  FATIGUE_GAMMA2_PER_METER_DESCENT,
  GAIN_FLAT_EQUIVALENT_METERS_PER_METER,
  GRADE_COST_BLEND_COLD_START,
  GRADE_COST_BLEND_HISTORY,
  HISTORY_SIMILARITY_MAX_RATIO,
  HISTORY_SIMILARITY_MIN_DISTANCE_METERS,
  HISTORY_SIMILARITY_MIN_RATIO,
  HISTORY_SIMILARITY_PREFER_MIN_DISTANCE_METERS,
  METERS_PER_MILE,
  RIEGEL_ENDURANCE_PACE_EXPONENT
} from "./constants.js";

export type RunnerProfile = {
  /**
   * Flat-equivalent baseline pace (seconds per meter). C1 (#483) converts trail summary pace to a
   * flat-equivalent GAP by charging elevation gain as extra flat distance, so the full physiological
   * M(g) curve (blend 1.0, C4) can apply on the course without double-counting terrain.
   */
  gapSecondsPerMeter: number;
  /** Flat-equivalent speed (m/s). */
  vBaseMps: number;
  /**
   * C2 (#483) Riegel endurance multiplier: scales the flat-equivalent baseline toward the course
   * distance ( (courseDistance / referenceDistance)^k ), clamped ≥ 1. Cold start = 1.
   */
  enduranceFactor: number;
  terrainEfficiency: number;
  /**
   * Fraction of grade/altitude cost model to apply (0–1). C4 (#483) sets this to 1.0 for both cold
   * start and history now that C1 removes the double-counting that motivated the old damping.
   */
  gradeCostBlend: number;
  gamma1: number;
  gamma2: number;
  coldStart: boolean;
  historyRefIds?: string[];
  explanation: string;
};

function usableHistory(history: ActivityHistoryRef[]): ActivityHistoryRef[] {
  return history.filter(
    (row) =>
      typeof row.distanceMeters === "number" &&
      row.distanceMeters > 0 &&
      typeof row.elapsedSeconds === "number" &&
      row.elapsedSeconds > 0
  );
}

function similarHistory(usable: ActivityHistoryRef[], courseDistance: number): ActivityHistoryRef[] {
  const inWindow = usable.filter((row) => {
    const distanceMeters = row.distanceMeters as number;
    if (distanceMeters < HISTORY_SIMILARITY_MIN_DISTANCE_METERS) {
      return false;
    }
    const ratio = distanceMeters / courseDistance;
    return ratio >= HISTORY_SIMILARITY_MIN_RATIO && ratio <= HISTORY_SIMILARITY_MAX_RATIO;
  });
  const preferred = inWindow.filter(
    (row) => (row.distanceMeters as number) >= HISTORY_SIMILARITY_PREFER_MIN_DISTANCE_METERS
  );
  // Prefer longer efforts (≥ ~12.4 mi) when available; else accept weekday training in the wide window.
  return preferred.length > 0 ? preferred : inWindow;
}

/**
 * C1 (#483): flat-equivalent pace (seconds per meter). Each activity's elevation gain is charged as
 * extra flat distance (GAIN_FLAT_EQUIVALENT_METERS_PER_METER m of flat per m climbed), so the summary
 * pace becomes a flat-equivalent GAP. Distance-weighted across the selected activities. Rows without
 * elevationGainMeters contribute 0 gain (pace treated as already flat).
 */
function flatEquivalentSecondsPerMeter(selected: ActivityHistoryRef[]): number {
  let elapsedSum = 0;
  let flatEquivalentDistanceSum = 0;
  for (const row of selected) {
    const distanceMeters = row.distanceMeters as number;
    const gainMeters = typeof row.elevationGainMeters === "number" ? row.elevationGainMeters : 0;
    elapsedSum += row.elapsedSeconds as number;
    flatEquivalentDistanceSum += distanceMeters + GAIN_FLAT_EQUIVALENT_METERS_PER_METER * gainMeters;
  }
  return elapsedSum / flatEquivalentDistanceSum;
}

/**
 * Distance-weighted reference distance (Σ D² / Σ D) — the "typical" effort length the flat-equivalent
 * pace represents. Used as the Riegel anchor so C2 scales pace by course-vs-typical distance.
 */
function referenceDistanceMeters(selected: ActivityHistoryRef[]): number {
  let distanceSum = 0;
  let distanceSquaredSum = 0;
  for (const row of selected) {
    const distanceMeters = row.distanceMeters as number;
    distanceSum += distanceMeters;
    distanceSquaredSum += distanceMeters * distanceMeters;
  }
  return distanceSum > 0 ? distanceSquaredSum / distanceSum : 0;
}

/**
 * C2 (#483): Riegel endurance multiplier on the flat-equivalent baseline. Longer-than-typical courses
 * are paced slower per the endurance exponent; shorter courses are clamped to 1 (no speed-up beyond
 * the observed pace). Cold start returns 1 (no reference distance).
 */
function enduranceFactorFor(referenceDistance: number, courseDistanceMeters: number): number {
  if (referenceDistance <= 0 || courseDistanceMeters <= 0) {
    return 1;
  }
  return Math.max(1, Math.pow(courseDistanceMeters / referenceDistance, RIEGEL_ENDURANCE_PACE_EXPONENT));
}

export function coldStartGapSecondsPerMeter(): number {
  return COLD_START_GAP_SECONDS_PER_MILE / METERS_PER_MILE;
}

/**
 * Build a runner profile from activity summaries (no track fit).
 * Cold start → GAP 10:00/mi with fuller grade model.
 * History → mean sec/m treated as trail-inclusive with dampened grade/altitude costs.
 */
export function buildRunnerProfile(input: {
  history: ActivityHistoryRef[];
  courseDistanceMeters: number;
}): RunnerProfile {
  const usable = usableHistory(input.history);
  const similar = similarHistory(usable, input.courseDistanceMeters);

  let gapSecondsPerMeter: number;
  let coldStart: boolean;
  let historyRefIds: string[] | undefined;
  let explanation: string;
  let gradeCostBlend: number;
  let enduranceFactor: number;

  if (usable.length === 0) {
    coldStart = true;
    gradeCostBlend = GRADE_COST_BLEND_COLD_START;
    gapSecondsPerMeter = coldStartGapSecondsPerMeter();
    enduranceFactor = 1;
    explanation =
      "Cold start: grade-adjusted baseline 10:00/mi with default terrain/fatigue coefficients. Upload similar history for a tighter plan.";
  } else if (similar.length > 0) {
    coldStart = false;
    gradeCostBlend = GRADE_COST_BLEND_HISTORY;
    gapSecondsPerMeter = flatEquivalentSecondsPerMeter(similar);
    enduranceFactor = enduranceFactorFor(referenceDistanceMeters(similar), input.courseDistanceMeters);
    historyRefIds = similar.map((row) => row.id);
    const excluded = usable.length - similar.length;
    explanation =
      excluded > 0
        ? `History-backed pace from ${similar.length} activit${similar.length === 1 ? "y" : "ies"} in the similarity window (flat-equivalent GAP with full grade model); ${excluded} outside the window excluded. Default fatigue coefficients.`
        : `History-backed pace from ${similar.length} activit${similar.length === 1 ? "y" : "ies"} (flat-equivalent GAP with full grade model). Default fatigue coefficients.`;
  } else {
    coldStart = false;
    gradeCostBlend = GRADE_COST_BLEND_HISTORY;
    gapSecondsPerMeter = flatEquivalentSecondsPerMeter(usable);
    enduranceFactor = enduranceFactorFor(referenceDistanceMeters(usable), input.courseDistanceMeters);
    historyRefIds = usable.map((row) => row.id);
    explanation =
      "History present but outside the similarity window; flat-equivalent GAP from available summaries (coarse). Default fatigue coefficients.";
  }

  const vBaseMps = 1 / gapSecondsPerMeter;
  return {
    gapSecondsPerMeter,
    vBaseMps,
    enduranceFactor,
    terrainEfficiency: DEFAULT_TERRAIN_EFFICIENCY,
    gradeCostBlend,
    gamma1: FATIGUE_GAMMA1_PER_METER_WORK,
    gamma2: FATIGUE_GAMMA2_PER_METER_DESCENT,
    coldStart,
    ...(historyRefIds !== undefined ? { historyRefIds } : {}),
    explanation
  };
}
