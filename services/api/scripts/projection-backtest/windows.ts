/**
 * Fits the arrival-window table (plan PR 5) from split-format data.
 *
 * For every runner, checkpoint k and target j (the next checkpoint, and the finish), the log error
 * of the remaining time is ln((a[j] − a[k]) / (eta − a[k])), with eta from the production live
 * formula (provisional constants). Errors are grouped by race-progress band and plan σ tier (each
 * tier's plan level redrawn at that tier's σ). The table's q10/q90 are fit on all courses; each
 * band's coverage is held out one course at a time, which is what the 70% gate reads.
 *
 * Course history isn't linked yet (PR 4), so every band is `hasHistory: false`.
 */
import { writeFileSync } from "node:fs";
import { PLAN_LOG_SIGMA } from "../../src/lib/projectionTuning.js";
import {
  WINDOW_MIN_COVERAGE,
  WINDOW_PROGRESS_BANDS,
  WINDOW_TARGET_COVERAGE,
  type PlanSigmaTier,
  type WindowBand,
  type WindowTable,
  type WindowTarget
} from "../../src/lib/arrivalWindows.js";
import { rescaleLevel, type BacktestData, type Effort } from "./data.js";
import { biasLayerEta, trustFromPlanSigma } from "./formulas.js";

type Sample = { course: string; logError: number };

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function samplesFor(efforts: readonly Effort[], planKey: string, sigma: number, target: WindowTarget, band: readonly [number, number]): Sample[] {
  const trust = trustFromPlanSigma(sigma);
  const out: Sample[] = [];
  for (const e of efforts) {
    const n = e.a.length - 1;
    const P = e.plans[planKey]!;
    for (let k = 1; k < n; k += 1) {
      const seen = e.d[k]! / e.d[n]!;
      if (seen < band[0] || seen >= band[1]) continue;
      const j = target === "next" ? k + 1 : n;
      if (target === "finish" && j === k + 1) continue; // at the last aid, "finish" is the next checkpoint
      const eta = biasLayerEta(e, P, k, j, trust);
      const predicted = eta - e.a[k]!;
      const actual = e.a[j]! - e.a[k]!;
      if (predicted > 0 && actual > 0) {
        out.push({ course: e.course, logError: Math.log(actual / predicted) });
      }
    }
  }
  return out;
}

export type WindowFit = { table: WindowTable; lines: string[] };

export function fitWindowTable(data: BacktestData, source: string): WindowFit {
  const bands: WindowBand[] = [];
  const lines: string[] = [];
  const tiers = Object.entries(PLAN_LOG_SIGMA) as Array<[PlanSigmaTier, number]>;
  for (const [tier, sigma] of tiers) {
    const key = `windows-${tier}`;
    rescaleLevel(data.efforts, sigma, "gpxFade", key);
    for (const target of ["next", "finish"] as const) {
      for (const band of WINDOW_PROGRESS_BANDS) {
        const samples = samplesFor(data.efforts, key, sigma, target, band);
        if (samples.length < 20) continue;
        const all = samples.map((s) => s.logError).sort((a, b) => a - b);
        // Held-out coverage: quantiles fit without the course, applied to the course.
        let inside = 0;
        let held = 0;
        for (const course of data.courses) {
          const train = samples.filter((s) => s.course !== course).map((s) => s.logError).sort((a, b) => a - b);
          const test = samples.filter((s) => s.course === course);
          if (train.length < 20 || test.length === 0) continue;
          const lo = quantile(train, 0.1);
          const hi = quantile(train, 0.9);
          inside += test.filter((s) => s.logError >= lo && s.logError <= hi).length;
          held += test.length;
        }
        const coverage = held > 0 ? inside / held : 0;
        const q10 = Math.min(0, quantile(all, 0.1));
        const q90 = Math.max(0, quantile(all, 0.9));
        bands.push({
          target,
          progressLo: band[0],
          progressHi: band[1],
          sigmaTier: tier,
          hasHistory: false,
          q10: Number(q10.toFixed(4)),
          q90: Number(q90.toFixed(4)),
          coverage: Number(coverage.toFixed(3)),
          samples: samples.length
        });
        const verdict =
          coverage < WINDOW_MIN_COVERAGE
            ? "OMITTED (< 70%)"
            : coverage < WINDOW_TARGET_COVERAGE.lo || coverage > WINDOW_TARGET_COVERAGE.hi
              ? "outside 75–85%"
              : "ok";
        lines.push(
          `  ${tier.padEnd(15)} ${target.padEnd(7)} ${band[0].toFixed(2)}-${Math.min(1, band[1]).toFixed(2)}  ` +
            `held-out ${(coverage * 100).toFixed(0).padStart(3)}%  ×${Math.exp(q10).toFixed(2)}–×${Math.exp(q90).toFixed(2)}  ` +
            `n=${String(samples.length).padStart(5)}  ${verdict}`
        );
      }
    }
  }
  return { table: { source, bands }, lines };
}

/** Writes the committed table module the projection imports. */
export function writeWindowTable(path: string, table: WindowTable): void {
  const body = `/**
 * Arrival-window quantile table, written by
 * \`npm run projection:backtest -- --analysis windows --write-windows\`. Do not edit by hand.
 * Source: ${table.source.replace(/\*\//g, "* /")}
 */
import type { WindowTable } from "./arrivalWindows.js";

export const ARRIVAL_WINDOW_TABLE: WindowTable | null = ${JSON.stringify(table, null, 2)};
`;
  writeFileSync(path, body);
}
