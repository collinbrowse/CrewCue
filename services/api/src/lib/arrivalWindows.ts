/**
 * Arrival windows: a 10th–90th percentile range around each live ETA.
 *
 * window = elapsedNow + remaining × [exp(q10), exp(q90)], where `remaining` is the live ETA's time
 * still to go and q10/q90 are log-error quantiles of (actual remaining ÷ predicted remaining). The
 * quantiles come from a table keyed by race progress band, the plan's σ tier, and whether the
 * course has linked history, with one entry for the next checkpoint and one for the finish.
 * Checkpoints in between interpolate by remaining plan time.
 *
 * The table is fit by `npm run projection:backtest -- --analysis windows --write-windows`, held
 * out one course at a time. A band whose held-out coverage is below WINDOW_MIN_COVERAGE gets no
 * window: the API omits it and clients show the ETA alone. Windows run only with
 * PROJECTION_TUNED_CONSTANTS on, like the rest of the tuned projection.
 */
import { PLAN_LOG_SIGMA } from "./projectionTuning.js";
import { ARRIVAL_WINDOW_TABLE } from "./arrivalWindowTable.js";

export type WindowTarget = "next" | "finish";
export type PlanSigmaTier = keyof typeof PLAN_LOG_SIGMA;

export type WindowBand = {
  target: WindowTarget;
  /** Fraction of the course covered, [progressLo, progressHi). */
  progressLo: number;
  progressHi: number;
  sigmaTier: PlanSigmaTier;
  hasHistory: boolean;
  /** Log-error quantiles of actual remaining ÷ predicted remaining. */
  q10: number;
  q90: number;
  /** Share of held-out predictions inside [q10, q90]; the gate reads this. */
  coverage: number;
  samples: number;
};

export type WindowTable = {
  /** What the table was fit on (dataset, permission, date). Shown in CONSTANTS_FOR_APPROVAL.md. */
  source: string;
  bands: WindowBand[];
};

/** A band below this held-out coverage gets no window. */
export const WINDOW_MIN_COVERAGE = 0.7;
/** The target coverage range the backtest reports against (80% nominal). */
export const WINDOW_TARGET_COVERAGE = { lo: 0.75, hi: 0.85 } as const;
/** The four race-progress bands. */
export const WINDOW_PROGRESS_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.25],
  [0.25, 0.5],
  [0.5, 0.75],
  [0.75, 1.01]
];

let tableForTests: WindowTable | null | undefined;

/** Test-only: use this table instead of the committed one (undefined restores it). */
export function setArrivalWindowTableForTests(table: WindowTable | null | undefined): void {
  tableForTests = table;
}

/** The σ tier a plan's planLogSigma is closest to. */
export function sigmaTierFor(planLogSigma: number): PlanSigmaTier {
  let best: PlanSigmaTier = "similarHistory";
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const [tier, sigma] of Object.entries(PLAN_LOG_SIGMA) as Array<[PlanSigmaTier, number]>) {
    const diff = Math.abs(Math.log(planLogSigma) - Math.log(sigma));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = tier;
    }
  }
  return best;
}

function bandFor(
  table: WindowTable,
  target: WindowTarget,
  seen: number,
  tier: PlanSigmaTier,
  hasHistory: boolean
): WindowBand | undefined {
  return table.bands.find(
    (band) =>
      band.target === target &&
      band.sigmaTier === tier &&
      band.hasHistory === hasHistory &&
      seen >= band.progressLo &&
      seen < band.progressHi
  );
}

/** Usable quantiles for one target, or null when the band is missing or under-covered. */
export function windowQuantiles(input: {
  target: WindowTarget;
  seen: number;
  planLogSigma: number;
  hasHistory: boolean;
  table?: WindowTable | null;
}): { q10: number; q90: number } | null {
  const table = input.table !== undefined ? input.table : tableForTests !== undefined ? tableForTests : ARRIVAL_WINDOW_TABLE;
  if (!table) {
    return null;
  }
  const seen = Math.min(1, Math.max(0, input.seen));
  const band = bandFor(table, input.target, seen, sigmaTierFor(input.planLogSigma), input.hasHistory);
  if (!band || band.coverage < WINDOW_MIN_COVERAGE || !(band.q10 <= 0 && band.q90 >= 0)) {
    return null;
  }
  return { q10: band.q10, q90: band.q90 };
}

/**
 * Window around one live ETA (elapsed seconds). `towardFinish` places a checkpoint between the
 * next checkpoint (0) and the finish (1) by remaining plan time, and the quantiles interpolate
 * linearly between the two. Null when either end has no usable band. Always contains the ETA.
 */
export function arrivalWindow(input: {
  elapsedNow: number;
  etaElapsed: number;
  seen: number;
  planLogSigma: number;
  hasHistory: boolean;
  towardFinish: number;
  table?: WindowTable | null;
}): { earliestElapsedSeconds: number; latestElapsedSeconds: number } | null {
  const common = {
    seen: input.seen,
    planLogSigma: input.planLogSigma,
    hasHistory: input.hasHistory,
    ...(input.table !== undefined ? { table: input.table } : {})
  };
  const next = windowQuantiles({ ...common, target: "next" });
  const finish = windowQuantiles({ ...common, target: "finish" });
  const t = Math.min(1, Math.max(0, input.towardFinish));
  // The next checkpoint needs only its own band; anything further needs both ends.
  if (!next || (t > 0 && !finish)) {
    return null;
  }
  const q10 = finish ? next.q10 + t * (finish.q10 - next.q10) : next.q10;
  const q90 = finish ? next.q90 + t * (finish.q90 - next.q90) : next.q90;
  const remaining = Math.max(0, input.etaElapsed - input.elapsedNow);
  return {
    earliestElapsedSeconds: Math.round(input.elapsedNow + remaining * Math.exp(Math.min(0, q10))),
    latestElapsedSeconds: Math.round(input.elapsedNow + remaining * Math.exp(Math.max(0, q90)))
  };
}
