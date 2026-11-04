/** Scoring, predictor builders, leave-one-course-out fitting, and table printing. */
import type { Effort } from "./data.js";
import {
  FIXED_PLAN_TRUST,
  anchoredEta,
  biasLayerEta,
  biasLayerFeatures,
  planOnlyEta,
  ratioEta,
  ratioParts
} from "./formulas.js";
import { accumulate, emptyNormal, mean, solve, sumNormal, type NormalEquations } from "./stats.js";

/** Predicted elapsed at checkpoint j, standing at checkpoint k; null = method has no answer. */
export type Predictor = (e: Effort, k: number, j: number) => number | null;

export const plan = (key: string): Predictor => (e, _k, j) => planOnlyEta(e.plans[key]!, j);
export const anchored = (key: string): Predictor => (e, k, j) => anchoredEta(e, e.plans[key]!, k, j);
export const ratio =
  (key: string, trust: number | ((e: Effort) => number) = FIXED_PLAN_TRUST): Predictor =>
  (e, k, j) =>
    ratioEta(e, e.plans[key]!, k, j, typeof trust === "number" ? trust : trust(e));

export type Score = { nextAid: number; finish: number; count: number };

/**
 * Average minutes off. Next aid: every k with j = k + 1. Finish: every k before the last aid
 * (standing at the last aid, the finish is the next aid), as the reference `score()` counts it.
 */
export function score(fn: Predictor, efforts: readonly Effort[]): Score {
  const next: number[] = [];
  const fin: number[] = [];
  for (const e of efforts) {
    const n = e.a.length - 1;
    for (let k = 1; k < n; k += 1) {
      const pn = fn(e, k, k + 1);
      if (pn !== null) {
        next.push(Math.abs(pn - e.a[k + 1]!) / 60);
      }
      if (k + 1 < n) {
        const pf = fn(e, k, n);
        if (pf !== null) {
          fin.push(Math.abs(pf - e.a[n]!) / 60);
        }
      }
    }
  }
  return { nextAid: mean(next), finish: mean(fin), count: fin.length };
}

/** Finish error (min) for checkpoints with lo ≤ progress < hi, last aid excluded. */
export function finishError(fn: Predictor, efforts: readonly Effort[], lo = 0, hi = 1.01): number {
  const errs: number[] = [];
  for (const e of efforts) {
    const n = e.a.length - 1;
    for (let k = 1; k < n - 1; k += 1) {
      const seen = e.d[k]! / e.d[n]!;
      if (seen >= lo && seen < hi) {
        const p = fn(e, k, n);
        if (p !== null) {
          errs.push(Math.abs(p - e.a[n]!) / 60);
        }
      }
    }
  }
  return mean(errs);
}

export const PROGRESS_BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.25],
  [0.25, 0.5],
  [0.5, 0.75],
  [0.75, 1.01]
];

export const bucketLabel = ([lo, hi]: readonly [number, number]) =>
  `${Math.round(lo * 100)}-${Math.round(Math.min(hi, 1) * 100)}%`;

/** Each (k, j ∈ {k+1, n}) pair once — the rows the learned layers fit on. */
export function* predictionPairs(e: Effort): Generator<[number, number]> {
  const n = e.a.length - 1;
  for (let k = 1; k < n; k += 1) {
    yield [k, k + 1];
    if (k + 1 !== n) {
      yield [k, n];
    }
  }
}

export type FitRow = { x: number[]; y: number; w: number };

/** Fit one weighted least-squares model per held-out course, on every other course's rows. */
export function fitLoco(
  courses: readonly string[],
  rowsFor: (course: string) => Iterable<FitRow>,
  features: number,
  ridge: number
): Map<string, number[]> {
  const parts = new Map<string, NormalEquations>();
  for (const course of courses) {
    const eq = emptyNormal(features);
    for (const row of rowsFor(course)) {
      accumulate(eq, row.x, row.y, row.w);
    }
    parts.set(course, eq);
  }
  const betas = new Map<string, number[]>();
  for (const course of courses) {
    const others = courses.filter((c) => c !== course).map((c) => parts.get(c)!);
    betas.set(course, solve(sumNormal(others, features), ridge) ?? new Array<number>(features).fill(0));
  }
  return betas;
}

/** Clamped log of actual / planned remaining time: the target the learned layers fit. */
export function logRemainingRatio(e: Effort, P: readonly number[], k: number, j: number): number {
  return Math.max(-1, Math.min(1, Math.log((e.a[j]! - e.a[k]!) / (P[j]! - P[k]!))));
}

/** B0 + 3-term progress-bias layer, fit LOCO (fresh_look3). `betas` override skips fitting. */
export function biasLayer(
  data: { courses: string[]; byCourse: Map<string, Effort[]> },
  planKey: string,
  trustOf: (e: Effort) => number,
  betas?: readonly number[]
): { fn: Predictor; betas: Map<string, number[]> } {
  const fitted =
    betas !== undefined
      ? new Map(data.courses.map((c) => [c, [...betas]]))
      : fitLoco(
          data.courses,
          function* (course) {
            for (const e of data.byCourse.get(course)!) {
              const P = e.plans[planKey]!;
              for (const [k, j] of predictionPairs(e)) {
                const parts = ratioParts(e, P, k, trustOf(e));
                yield {
                  x: biasLayerFeatures(parts.seen, parts.w, parts.logRatio),
                  y: logRemainingRatio(e, P, k, j) - parts.logBase,
                  w: (P[j]! - P[k]!) / 3600
                };
              }
            }
          },
          3,
          1e-4
        );
  return {
    fn: (e, k, j) => biasLayerEta(e, e.plans[planKey]!, k, j, trustOf(e), fitted.get(e.course)!),
    betas: fitted
  };
}

// ---------- printing ----------

export const out = (line = "") => process.stdout.write(`${line}\n`);
export const fmt = (v: number, width = 8, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : "-").padStart(width);

export function methodTable(title: string, efforts: readonly Effort[], rows: Array<[string, Predictor]>): void {
  out(`\n${title}  (${efforts.length} runners)`);
  out(`  ${"method".padEnd(54)}next aid   finish`);
  for (const [label, fn] of rows) {
    const s = score(fn, efforts);
    out(`  ${label.padEnd(54)}${fmt(s.nextAid, 7)}  ${fmt(s.finish, 7)}`);
  }
}

export function courseTable(
  title: string,
  courses: readonly string[],
  byCourse: Map<string, Effort[]>,
  rows: Array<[string, Predictor]>
): void {
  out(`\n${title}`);
  out(`  ${"method".padEnd(46)}${courses.map((c) => c.slice(0, 11).padStart(12)).join("")}`);
  for (const [label, fn] of rows) {
    out(`  ${label.padEnd(46)}${courses.map((c) => fmt(finishError(fn, byCourse.get(c)!), 12)).join("")}`);
  }
}
