/**
 * Pacing evaluation: score every predictor on every corpus effort, summarize per split, and gate
 * the production model against a committed metrics baseline (CI regression check).
 */
import { corpusFingerprint, type EvaluationSplit, type LoadedEffort } from "./corpus.js";
import { scoreEffort, summarize, type EffortScore, type SummaryMetrics } from "./metrics.js";
import { EVALUATION_PREDICTORS, prepareEffort, type Predictor, type PredictorId } from "./predictors.js";

export type SplitSelection = EvaluationSplit | "all";
export const SPLIT_SELECTIONS: readonly SplitSelection[] = ["all", "tune", "holdout"];

export type EvaluationResult = {
  corpusFingerprint: string;
  effortCount: number;
  provenanceCounts: Record<string, number>;
  predictors: Array<Pick<Predictor, "id" | "label" | "description">>;
  scores: EffortScore[];
  /** summaries[predictorId][split]; a split with no efforts is omitted. */
  summaries: Record<PredictorId, Partial<Record<SplitSelection, SummaryMetrics>>>;
};

export function runEvaluation(
  efforts: LoadedEffort[],
  predictors: readonly Predictor[] = EVALUATION_PREDICTORS
): EvaluationResult {
  const prepared = efforts.map(prepareEffort);
  const scores: EffortScore[] = [];
  for (const predictor of predictors) {
    for (const effort of prepared) {
      scores.push(scoreEffort(effort, predictor.id, predictor.predict(effort)));
    }
  }

  const summaries = {} as EvaluationResult["summaries"];
  for (const predictor of predictors) {
    const own = scores.filter((score) => score.predictorId === predictor.id);
    const bySplit: Partial<Record<SplitSelection, SummaryMetrics>> = {};
    for (const split of SPLIT_SELECTIONS) {
      const selected = split === "all" ? own : own.filter((score) => score.split === split);
      if (selected.length > 0) {
        bySplit[split] = summarize(selected);
      }
    }
    summaries[predictor.id] = bySplit;
  }

  const provenanceCounts: Record<string, number> = {};
  for (const effort of efforts) {
    provenanceCounts[effort.provenance.kind] = (provenanceCounts[effort.provenance.kind] ?? 0) + 1;
  }

  return {
    corpusFingerprint: corpusFingerprint(efforts),
    effortCount: efforts.length,
    provenanceCounts,
    predictors: predictors.map(({ id, label, description }) => ({ id, label, description })),
    scores,
    summaries
  };
}

// ---------------------------------------------------------------------------------------------
// Regression gate
// ---------------------------------------------------------------------------------------------

/** Predictor whose accuracy is gated. Baselines are reported, not gated. */
export const GATED_PREDICTOR: PredictorId = "micro-model";
/**
 * Allowed drift in percentage points before the gate fails. The harness is deterministic, so this
 * only absorbs float noise across Node/V8 versions, not genuine model changes.
 */
export const GATE_TOLERANCE_PCT_POINTS = 0.05;

type GatedMetric = {
  key: string;
  read: (summary: SummaryMetrics) => number;
};

/** Lower is better for every gated metric. */
const GATED_METRICS: readonly GatedMetric[] = [
  { key: "finish.mapePct", read: (s) => s.finish.mapePct },
  { key: "finish.absBiasPct", read: (s) => Math.abs(s.finish.biasPct) },
  { key: "checkpoints.mapePct", read: (s) => s.checkpoints.mapePct },
  { key: "shape.mapePct", read: (s) => s.shape.mapePct }
];

export type MetricsBaseline = {
  schemaVersion: 1;
  corpusFingerprint: string;
  predictor: PredictorId;
  /** metrics[split][metricKey], rounded to 0.001. */
  metrics: Partial<Record<SplitSelection, Record<string, number>>>;
};

export type GateFinding = {
  split: SplitSelection;
  metric: string;
  baseline: number;
  current: number;
};

export type GateOutcome = {
  ok: boolean;
  corpusChanged: boolean;
  regressions: GateFinding[];
  improvements: GateFinding[];
};

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function buildMetricsBaseline(result: EvaluationResult): MetricsBaseline {
  const metrics: MetricsBaseline["metrics"] = {};
  const gated = result.summaries[GATED_PREDICTOR];
  for (const split of SPLIT_SELECTIONS) {
    const summary = gated[split];
    if (summary) {
      metrics[split] = Object.fromEntries(GATED_METRICS.map((metric) => [metric.key, round3(metric.read(summary))]));
    }
  }
  return { schemaVersion: 1, corpusFingerprint: result.corpusFingerprint, predictor: GATED_PREDICTOR, metrics };
}

export function checkAgainstBaseline(result: EvaluationResult, baseline: MetricsBaseline): GateOutcome {
  if (baseline.corpusFingerprint !== result.corpusFingerprint) {
    return { ok: false, corpusChanged: true, regressions: [], improvements: [] };
  }
  const current = buildMetricsBaseline(result).metrics;
  const regressions: GateFinding[] = [];
  const improvements: GateFinding[] = [];
  for (const split of SPLIT_SELECTIONS) {
    const before = baseline.metrics[split];
    const after = current[split];
    if (!before || !after) {
      continue;
    }
    for (const metric of GATED_METRICS) {
      const was = before[metric.key];
      const now = after[metric.key];
      if (was === undefined || now === undefined) {
        continue;
      }
      if (now > was + GATE_TOLERANCE_PCT_POINTS) {
        regressions.push({ split, metric: metric.key, baseline: was, current: now });
      } else if (now < was - GATE_TOLERANCE_PCT_POINTS) {
        improvements.push({ split, metric: metric.key, baseline: was, current: now });
      }
    }
  }
  // Ratchet: an unrecorded improvement also fails, so the baseline always reflects the model and a
  // later change cannot quietly give the gain back.
  return { ok: regressions.length === 0 && improvements.length === 0, corpusChanged: false, regressions, improvements };
}
