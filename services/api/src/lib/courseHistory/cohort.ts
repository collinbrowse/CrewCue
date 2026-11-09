/**
 * Past finishers of a linked course, lined up on the room's own checkpoints (plan PR 4), and the
 * two things the product does with them:
 * - the pre-race plan shape (median share of finish time at each checkpoint among past finishers
 *   of similar planned finish), and
 * - the live past-runners estimate (finishers who reached the runner's last checkpoint at a
 *   similar elapsed time, and what they took from there).
 * Only `product` events are used. Nothing here applies below COURSE_HISTORY_MIN_FINISHERS.
 */
import type { RaceCourse } from "@crewcue/contracts";
import { completeArrivalSeconds } from "./format.js";
import { mapCheckpoints } from "./link.js";
import type { StoredCourseHistoryEvent } from "./store.js";

/** Past finishers needed on the mapped layout before history changes a plan or an ETA. */
export const COURSE_HISTORY_MIN_FINISHERS = 25;
/** Plan shape: finishers within ±10% of the planned finish (at least 5, else the nearest 10). */
export const COHORT_PLAN_BAND = 0.1;
/** Live: finishers within ±30% of the runner's elapsed at the last checkpoint (nearest 100, at least 4). */
export const COHORT_LIVE_BAND = 0.3;
export const COHORT_LIVE_MIN_MATCHES = 4;

export type Cohort = {
  /** Room checkpoint ids every linked event maps, in course order (start and finish included). */
  checkpointIds: string[];
  /** One row per past finisher: elapsed seconds at each of `checkpointIds`. */
  arrivals: number[][];
  eventIds: string[];
};

export function buildCohort(course: RaceCourse, events: readonly StoredCourseHistoryEvent[]): Cohort {
  const product = events.filter((e) => e.usage === "product");
  const mappings = product.map((e) => mapCheckpoints(course, e.event));
  const checkpointIds = course.checkpoints.map((cp) => cp.id).filter((id) => mappings.every((m) => m.has(id)));
  const arrivals: number[][] = [];
  product.forEach(({ event }, i) => {
    const mapping = mappings[i]!;
    const indexOf = new Map(event.checkpoints.map((cp, j) => [cp.id, j]));
    for (const effort of event.efforts) {
      const full = completeArrivalSeconds(event, effort);
      if (!full) continue;
      arrivals.push(checkpointIds.map((id) => full[indexOf.get(mapping.get(id)!)!]!));
    }
  });
  return { checkpointIds: product.length > 0 ? checkpointIds : [], arrivals, eventIds: product.map((e) => e.id) };
}

export function cohortIsUsable(cohort: Cohort): boolean {
  return cohort.arrivals.length >= COURSE_HISTORY_MIN_FINISHERS && cohort.checkpointIds.length >= 2;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** Planned elapsed at each cohort checkpoint for a runner planned to finish in `plannedFinish` s. */
export function cohortPlanElapsed(cohort: Cohort, plannedFinish: number): number[] {
  const finishOf = (row: number[]) => row[row.length - 1]!;
  let near = cohort.arrivals.filter((row) => Math.abs(finishOf(row) / plannedFinish - 1) <= COHORT_PLAN_BAND);
  if (near.length < 5) {
    near = [...cohort.arrivals].sort((a, b) => Math.abs(finishOf(a) - plannedFinish) - Math.abs(finishOf(b) - plannedFinish)).slice(0, 10);
  }
  return cohort.checkpointIds.map((_, i) => median(near.map((row) => row[i]! / finishOf(row))) * plannedFinish);
}

/**
 * Past-runners estimate of elapsed at cohort checkpoint `j`, standing at cohort checkpoint `k`
 * with elapsed `elapsedAtK`. Null with fewer than COHORT_LIVE_MIN_MATCHES similar finishers.
 */
export function pastRunnersElapsed(cohort: Cohort, k: number, j: number, elapsedAtK: number): number | null {
  if (elapsedAtK <= 0) return null;
  const near = cohort.arrivals
    .filter((row) => Math.abs(row[k]! / elapsedAtK - 1) <= COHORT_LIVE_BAND)
    .sort((a, b) => Math.abs(a[k]! - elapsedAtK) - Math.abs(b[k]! - elapsedAtK))
    .slice(0, 100);
  if (near.length < COHORT_LIVE_MIN_MATCHES) return null;
  const ratios = near.map((row) => (row[j]! - row[k]!) / row[k]!).sort((a, b) => a - b);
  const q1 = ratios[ratios.length >> 2]!;
  const q3 = ratios[(3 * ratios.length) >> 2]!;
  const iqr = q3 - q1;
  const kept = ratios.filter((r) => r >= q1 - 1.5 * iqr && r <= q3 + 1.5 * iqr);
  const use = kept.length > 0 ? kept : ratios;
  return elapsedAtK * (1 + use.reduce((s, r) => s + r, 0) / use.length);
}

/**
 * Reshapes a moving-time plan curve so it passes through `anchors` (distance → elapsed), stretching
 * each section between anchors in time and keeping the curve's shape inside it.
 */
export function reshapeCurve(
  curve: ReadonlyArray<{ distanceMetersFromStart: number; referenceElapsedSeconds: number }>,
  anchors: ReadonlyArray<{ distanceMeters: number; elapsedSeconds: number }>
): Array<{ distanceMetersFromStart: number; referenceElapsedSeconds: number }> {
  const at = (d: number) => {
    let i = 1;
    while (i < curve.length - 1 && curve[i]!.distanceMetersFromStart < d) i += 1;
    const a = curve[i - 1]!;
    const b = curve[i]!;
    const span = b.distanceMetersFromStart - a.distanceMetersFromStart;
    const t = span > 0 ? (d - a.distanceMetersFromStart) / span : 0;
    return a.referenceElapsedSeconds + t * (b.referenceElapsedSeconds - a.referenceElapsedSeconds);
  };
  const sorted = [...anchors].sort((a, b) => a.distanceMeters - b.distanceMeters);
  return curve.map((point) => {
    const d = point.distanceMetersFromStart;
    let i = 1;
    while (i < sorted.length - 1 && sorted[i]!.distanceMeters < d) i += 1;
    const lo = sorted[i - 1]!;
    const hi = sorted[i]!;
    const from = at(lo.distanceMeters);
    const to = at(hi.distanceMeters);
    const t = to > from ? (point.referenceElapsedSeconds - from) / (to - from) : 0;
    return {
      distanceMetersFromStart: d,
      referenceElapsedSeconds: lo.elapsedSeconds + t * (hi.elapsedSeconds - lo.elapsedSeconds)
    };
  });
}
