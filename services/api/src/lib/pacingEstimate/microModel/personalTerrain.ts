/**
 * Slice 3 of docs/product/run-import-and-grade-curve-scope.md: the runner's own climbing and
 * descent, learned from the grade profiles of their imported runs, as factors on the shared
 * grade-cost curve.
 *
 * Classes: flat, runnable climb (4% up to the runner's switch grade), hiking-grade climb (switch
 * grade and steeper), runnable descent (−4% to −15%) and steep descent (steeper than −15%). Each
 * run is first scaled by its own level (moving time ÷ shared-curve cost), so effort cancels: an easy
 * day and a race both say how this runner climbs relative to their own pace. Time and expected time
 * are pooled across runs per class and shrunk toward 1 by TERRAIN_SHRINK_METERS.
 *
 * Validated on the owner's 166 runs (Nov 2025–Nov 2026, leave-one-run-out): moving time misplaced
 * by km 5.0% vs 4.9% for the shared curve; the factors were stable from 14 runs to 166. Off unless
 * PERSONAL_TERRAIN_FACTORS is on.
 */
import type { ActivityHistoryRef } from "@crewcue/contracts";
import { gradeCostMultiplier } from "./simulate.js";

export const TERRAIN_CLASS_NAMES = [
  "flat",
  "runnable climb",
  "hiking-grade climb",
  "runnable descent",
  "steep descent"
] as const;
/** Meters of a class before the runner's own factor counts as much as the shared curve. */
export const TERRAIN_SHRINK_METERS = 500;
/** Switch grade when the runner's runs don't show one. */
export const DEFAULT_SWITCH_GRADE = 0.12;
/** A grade needs this much climbing distance before its hike share decides the switch grade. */
const SWITCH_MIN_METERS = 200;
const RUNNABLE_CLIMB_MIN = 0.04;
const STEEP_DESCENT_MAX = -0.15;
const FLAT_LIMIT = 0.04;
/** Factors are kept within this range, whatever the data. */
export const TERRAIN_FACTOR_RANGE = { min: 0.7, max: 1.4 } as const;

export type PersonalTerrain = {
  switchGrade: number;
  /** One factor per TERRAIN_CLASS_NAMES entry; 1 = the shared curve. */
  factors: number[];
  /** Runs with a grade profile that fed the factors. */
  basedOnRuns: number;
};

export function isPersonalTerrainEnabled(): boolean {
  const raw = process.env.PERSONAL_TERRAIN_FACTORS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export function terrainClass(grade: number, switchGrade: number): number {
  if (grade >= switchGrade) return 2;
  if (grade >= RUNNABLE_CLIMB_MIN) return 1;
  if (grade <= STEEP_DESCENT_MAX) return 4;
  if (grade <= -FLAT_LIMIT) return 3;
  return 0;
}

const shared = (grade: number) => gradeCostMultiplier(grade, 1, 1);

/** The runner's factors from their runs' grade profiles, or null when none has one. */
export function personalTerrainFrom(history: readonly ActivityHistoryRef[]): PersonalTerrain | null {
  const profiles = history.flatMap((row) => (row.gradeProfile ? [row.gradeProfile] : []));
  if (profiles.length === 0) return null;

  // Switch grade: the lowest climb grade (≥ 4%) where at least half the distance was hiked.
  const climb = new Map<number, { hiked: number; total: number }>();
  for (const profile of profiles) {
    for (const bin of profile.bins) {
      if (bin.gradePercent < RUNNABLE_CLIMB_MIN * 100) continue;
      const row = climb.get(bin.gradePercent) ?? { hiked: 0, total: 0 };
      row.hiked += bin.hikeMeters;
      row.total += bin.runMeters + bin.hikeMeters;
      climb.set(bin.gradePercent, row);
    }
  }
  let switchGrade = DEFAULT_SWITCH_GRADE;
  for (const pct of [...climb.keys()].sort((a, b) => a - b)) {
    const row = climb.get(pct)!;
    if (row.total >= SWITCH_MIN_METERS && row.hiked / row.total >= 0.5) {
      switchGrade = pct / 100;
      break;
    }
  }

  const seconds = new Array<number>(TERRAIN_CLASS_NAMES.length).fill(0);
  const expected = new Array<number>(TERRAIN_CLASS_NAMES.length).fill(0);
  const meters = new Array<number>(TERRAIN_CLASS_NAMES.length).fill(0);
  for (const profile of profiles) {
    let runSeconds = 0;
    let runCost = 0;
    for (const bin of profile.bins) {
      const m = bin.runMeters + bin.hikeMeters;
      runSeconds += bin.runSeconds + bin.hikeSeconds;
      runCost += m * shared(bin.gradePercent / 100);
    }
    if (!(runSeconds > 0 && runCost > 0)) continue;
    const level = runSeconds / runCost;
    for (const bin of profile.bins) {
      const m = bin.runMeters + bin.hikeMeters;
      const c = terrainClass(bin.gradePercent / 100, switchGrade);
      seconds[c]! += bin.runSeconds + bin.hikeSeconds;
      expected[c]! += level * m * shared(bin.gradePercent / 100);
      meters[c]! += m;
    }
  }
  const factors = seconds.map((sec, c) => {
    if (!(expected[c]! > 0)) return 1;
    const ratio = sec / expected[c]!;
    const shrunk = (meters[c]! * ratio + TERRAIN_SHRINK_METERS) / (meters[c]! + TERRAIN_SHRINK_METERS);
    return Math.min(TERRAIN_FACTOR_RANGE.max, Math.max(TERRAIN_FACTOR_RANGE.min, shrunk));
  });
  return { switchGrade, factors, basedOnRuns: profiles.length };
}

/** The factor on the shared curve at a grade (1 without personal terrain). */
export function terrainFactorAt(grade: number, terrain: PersonalTerrain | undefined): number {
  if (!terrain) return 1;
  return terrain.factors[terrainClass(grade, terrain.switchGrade)] ?? 1;
}
