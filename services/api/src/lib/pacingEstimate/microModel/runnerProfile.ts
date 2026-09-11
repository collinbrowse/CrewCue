/**
 * Runner profile for micro-model (defaults + optional summary-based GAP).
 */
import type { ActivityHistoryRef } from "@crewcue/contracts";
import {
  COLD_START_GAP_SECONDS_PER_MILE,
  DEFAULT_TERRAIN_EFFICIENCY,
  FATIGUE_GAMMA1_PER_METER_WORK,
  FATIGUE_GAMMA2_PER_METER_DESCENT,
  GRADE_COST_BLEND_COLD_START,
  GRADE_COST_BLEND_HISTORY,
  HISTORY_SIMILARITY_MAX_RATIO,
  HISTORY_SIMILARITY_MIN_DISTANCE_METERS,
  HISTORY_SIMILARITY_MIN_RATIO,
  HISTORY_SIMILARITY_PREFER_MIN_DISTANCE_METERS,
  METERS_PER_MILE
} from "./constants.js";

export type RunnerProfile = {
  /**
   * Baseline pace (seconds per meter).
   * Cold start: true flat GAP. History: distance-weighted mean of activity summaries
   * (already includes typical trail cost — do not treat as pure flat GAP).
   */
  gapSecondsPerMeter: number;
  /** Flat-equivalent speed (m/s). */
  vBaseMps: number;
  terrainEfficiency: number;
  /**
   * Fraction of grade/altitude cost model to apply (0–1).
   * History-backed uses a low blend to avoid double-counting hills already in summary pace.
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

/** Distance-weighted mean pace (longer activities dominate without dropping shorter ones when preferred). */
function meanSecondsPerMeter(selected: ActivityHistoryRef[]): number {
  let elapsedSum = 0;
  let distanceSum = 0;
  for (const row of selected) {
    elapsedSum += row.elapsedSeconds as number;
    distanceSum += row.distanceMeters as number;
  }
  return elapsedSum / distanceSum;
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

  if (usable.length === 0) {
    coldStart = true;
    gradeCostBlend = GRADE_COST_BLEND_COLD_START;
    gapSecondsPerMeter = coldStartGapSecondsPerMeter();
    explanation =
      "Cold start: grade-adjusted baseline 10:00/mi with default terrain/fatigue coefficients. Upload similar history for a tighter plan.";
  } else if (similar.length > 0) {
    coldStart = false;
    gradeCostBlend = GRADE_COST_BLEND_HISTORY;
    gapSecondsPerMeter = meanSecondsPerMeter(similar);
    historyRefIds = similar.map((row) => row.id);
    const excluded = usable.length - similar.length;
    explanation =
      excluded > 0
        ? `History-backed pace from ${similar.length} activit${similar.length === 1 ? "y" : "ies"} in the similarity window (summaries; trail cost mostly baked in); ${excluded} outside the window excluded. Default fatigue coefficients.`
        : `History-backed pace from ${similar.length} activit${similar.length === 1 ? "y" : "ies"} (summaries; trail cost mostly baked in). Default fatigue coefficients.`;
  } else {
    coldStart = false;
    gradeCostBlend = GRADE_COST_BLEND_HISTORY;
    gapSecondsPerMeter = meanSecondsPerMeter(usable);
    historyRefIds = usable.map((row) => row.id);
    explanation =
      "History present but outside the similarity window; pace from available summaries (coarse; trail cost mostly baked in). Default fatigue coefficients.";
  }

  const vBaseMps = 1 / gapSecondsPerMeter;
  return {
    gapSecondsPerMeter,
    vBaseMps,
    terrainEfficiency: DEFAULT_TERRAIN_EFFICIENCY,
    gradeCostBlend,
    gamma1: FATIGUE_GAMMA1_PER_METER_WORK,
    gamma2: FATIGUE_GAMMA2_PER_METER_DESCENT,
    coldStart,
    ...(historyRefIds !== undefined ? { historyRefIds } : {}),
    explanation
  };
}
