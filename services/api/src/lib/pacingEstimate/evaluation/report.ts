/**
 * Text and Markdown rendering for evaluation results (CLI output and PR bodies).
 */
import type { EvaluationResult, GateOutcome, SplitSelection } from "./evaluate.js";
import { PROGRESS_THIRDS, TERRAIN_CLASSES, type SummaryMetrics } from "./metrics.js";

type Column = { header: string; cell: (summary: SummaryMetrics) => string };

function pct(value: number): string {
  return `${value >= 0 ? "" : "−"}${Math.abs(value).toFixed(1)}%`;
}

function signedPct(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

function share(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const HEADLINE_COLUMNS: readonly Column[] = [
  { header: "Finish MAPE", cell: (s) => pct(s.finish.mapePct) },
  { header: "Finish bias", cell: (s) => signedPct(s.finish.biasPct) },
  { header: "Finish MAE", cell: (s) => `${s.finish.maeMinutes.toFixed(0)}m` },
  { header: "≤5%", cell: (s) => share(s.finish.within5PctShare) },
  { header: "≤10%", cell: (s) => share(s.finish.within10PctShare) },
  { header: "CP MAPE", cell: (s) => pct(s.checkpoints.mapePct) },
  { header: "CP ≤15m", cell: (s) => share(s.checkpoints.within15MinShare) },
  { header: "CP ≤30m", cell: (s) => share(s.checkpoints.within30MinShare) },
  { header: "Shape MAPE", cell: (s) => pct(s.shape.mapePct) }
];

function rowsFor(result: EvaluationResult, split: SplitSelection): Array<{ label: string; summary: SummaryMetrics }> {
  return result.predictors.flatMap((predictor) => {
    const summary = result.summaries[predictor.id]?.[split];
    return summary ? [{ label: predictor.label, summary }] : [];
  });
}

function splitTitle(result: EvaluationResult, split: SplitSelection): string {
  const n = result.summaries[result.predictors[0]!.id]?.[split]?.efforts ?? 0;
  return `${split} (${n} efforts)`;
}

function markdownTable(headers: string[], rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

function textTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]!.length)));
  const line = (cells: string[]): string => cells.map((cell, index) => cell.padEnd(widths[index]!)).join("  ");
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join("\n");
}

function bucketCell(bucket: { n: number; mapePct: number; biasPct: number }): string {
  return bucket.n === 0 ? "—" : `${pct(bucket.mapePct)} (${signedPct(bucket.biasPct)}, n=${bucket.n})`;
}

function sections(result: EvaluationResult, splits: SplitSelection[]): Array<{ title: string; headers: string[]; rows: string[][] }> {
  const out: Array<{ title: string; headers: string[]; rows: string[][] }> = [];
  for (const split of splits) {
    const rows = rowsFor(result, split);
    if (rows.length === 0) {
      continue;
    }
    out.push({
      title: `Headline — ${splitTitle(result, split)}`,
      headers: ["Predictor", ...HEADLINE_COLUMNS.map((column) => column.header)],
      rows: rows.map(({ label, summary }) => [label, ...HEADLINE_COLUMNS.map((column) => column.cell(summary))])
    });
    out.push({
      title: `Aid-to-aid segment error by terrain — ${split} (MAPE, bias, n)`,
      headers: ["Predictor", ...TERRAIN_CLASSES],
      rows: rows.map(({ label, summary }) => [label, ...TERRAIN_CLASSES.map((terrain) => bucketCell(summary.segmentsByTerrain[terrain]))])
    });
    out.push({
      title: `Aid-to-aid segment error by race progress — ${split} (MAPE, bias, n)`,
      headers: ["Predictor", ...PROGRESS_THIRDS],
      rows: rows.map(({ label, summary }) => [label, ...PROGRESS_THIRDS.map((third) => bucketCell(summary.segmentsByProgress[third]))])
    });
  }
  return out;
}

function corpusLine(result: EvaluationResult): string {
  const kinds = Object.entries(result.provenanceCounts)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(", ");
  return `Corpus ${result.corpusFingerprint}: ${result.effortCount} efforts (${kinds}).`;
}

export function renderText(result: EvaluationResult, splits: SplitSelection[]): string {
  const parts = [corpusLine(result)];
  if (result.provenanceCounts.synthetic === result.effortCount) {
    parts.push("NOTE: every effort is SYNTHETIC. These numbers measure the harness, not real-world accuracy.");
  }
  for (const section of sections(result, splits)) {
    parts.push(`\n${section.title}\n${textTable(section.headers, section.rows)}`);
  }
  parts.push(
    "\nErrors are predicted − actual moving time (positive = predicted too slow). Shape = error after scaling the prediction to the actual finish."
  );
  return `${parts.join("\n")}\n`;
}

export function renderMarkdown(result: EvaluationResult, splits: SplitSelection[]): string {
  const parts = [corpusLine(result)];
  if (result.provenanceCounts.synthetic === result.effortCount) {
    parts.push("> Every effort is **synthetic**. These numbers measure the harness, not real-world accuracy.");
  }
  for (const section of sections(result, splits)) {
    parts.push(`**${section.title}**\n\n${markdownTable(section.headers, section.rows)}`);
  }
  return `${parts.join("\n\n")}\n`;
}

export function renderGate(outcome: GateOutcome): string {
  if (outcome.corpusChanged) {
    return "Corpus changed since the metrics baseline was recorded. Review the new numbers, then run `npm run pacing:eval -w @crewcue/api -- --write-baseline`.\n";
  }
  if (outcome.ok) {
    return "Pacing accuracy gate: OK (micro-model matches the recorded baseline).\n";
  }
  const lines: string[] = [];
  for (const finding of outcome.regressions) {
    lines.push(`REGRESSION ${finding.split} ${finding.metric}: ${finding.baseline.toFixed(3)} → ${finding.current.toFixed(3)}`);
  }
  for (const finding of outcome.improvements) {
    lines.push(`IMPROVED   ${finding.split} ${finding.metric}: ${finding.baseline.toFixed(3)} → ${finding.current.toFixed(3)}`);
  }
  const hint =
    outcome.regressions.length > 0
      ? "The micro-model got less accurate on the evaluation corpus. Fix the change, or justify it in the PR and re-record with --write-baseline."
      : "The micro-model improved. Re-record with --write-baseline so the gain is locked in (include before/after in the PR).";
  return `Pacing accuracy gate: FAILED\n${lines.join("\n")}\n${hint}\n`;
}

/** Per-effort finish error for one predictor (for `--detail`). */
export function renderEffortDetail(result: EvaluationResult, predictorId: string): string {
  const rows = result.scores
    .filter((score) => score.predictorId === predictorId)
    .map((score) => [
      score.effortId,
      score.split,
      `${(score.courseLengthMeters / 1000).toFixed(1)} km`,
      formatHours(score.finish.actualSeconds),
      formatHours(score.finish.predictedSeconds),
      signedPct(score.finish.percentError),
      score.checkpoints.length > 1
        ? pct(score.checkpoints.slice(0, -1).reduce((sum, row) => sum + Math.abs(row.shapePercentError), 0) / (score.checkpoints.length - 1))
        : "—"
    ]);
  return `\nPer effort — ${predictorId}\n${textTable(["Effort", "Split", "Course", "Actual", "Predicted", "Finish err", "Shape MAPE"], rows)}\n`;
}

function formatHours(seconds: number): string {
  const total = Math.round(seconds / 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
