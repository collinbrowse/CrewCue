/**
 * Pacing model evaluation over the effort corpus (docs/sdlc/pacing-evaluation.md).
 *
 * Usage (from repo root):
 *   npm run pacing:eval -w @crewcue/api                      # report: all / tune / holdout
 *   npm run pacing:eval -w @crewcue/api -- --split holdout
 *   npm run pacing:eval -w @crewcue/api -- --markdown        # tables for a PR body
 *   npm run pacing:eval -w @crewcue/api -- --json            # full machine-readable result
 *   npm run pacing:eval -w @crewcue/api -- --detail          # per-effort finish errors
 *   npm run pacing:eval -w @crewcue/api -- --check           # CI gate vs metrics-baseline.json
 *   npm run pacing:eval -w @crewcue/api -- --write-baseline  # re-record after an intended change
 *   npm run pacing:eval -w @crewcue/api -- --corpus /path/to/corpus
 *
 * Deterministic; no network, no database. The same gate runs inside `npm run test -w @crewcue/api`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadEvaluationCorpus } from "../src/lib/pacingEstimate/evaluation/corpus.js";
import {
  buildMetricsBaseline,
  checkAgainstBaseline,
  GATED_PREDICTOR,
  runEvaluation,
  SPLIT_SELECTIONS,
  type MetricsBaseline,
  type SplitSelection
} from "../src/lib/pacingEstimate/evaluation/evaluate.js";
import { renderEffortDetail, renderGate, renderMarkdown, renderText } from "../src/lib/pacingEstimate/evaluation/report.js";

const BASELINE_FILE = "metrics-baseline.json";

function defaultCorpusDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing/eval");
    if (existsSync(resolve(candidate, "efforts"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing/eval not found (looked up the directory tree)");
}

function main(): void {
  const { values } = parseArgs({
    options: {
      corpus: { type: "string" },
      split: { type: "string" },
      markdown: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      detail: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      "write-baseline": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  if (values.help) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]!.replace("/**", "") + "\n");
    return;
  }
  const split = values.split as SplitSelection | undefined;
  if (split !== undefined && !SPLIT_SELECTIONS.includes(split)) {
    throw new Error(`--split must be one of ${SPLIT_SELECTIONS.join(", ")}`);
  }
  const corpusDir = values.corpus ? resolve(values.corpus) : defaultCorpusDir();
  const result = runEvaluation(loadEvaluationCorpus(corpusDir));
  const splits = split ? [split] : [...SPLIT_SELECTIONS];
  const baselinePath = resolve(corpusDir, BASELINE_FILE);

  if (values["write-baseline"]) {
    writeFileSync(baselinePath, `${JSON.stringify(buildMetricsBaseline(result), null, 2)}\n`);
    process.stdout.write(`Wrote ${baselinePath}\n`);
    return;
  }
  if (values.check) {
    if (!existsSync(baselinePath)) {
      throw new Error(`No ${BASELINE_FILE} in ${corpusDir}; run with --write-baseline first`);
    }
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as MetricsBaseline;
    const outcome = checkAgainstBaseline(result, baseline);
    process.stdout.write(renderGate(outcome));
    process.exitCode = outcome.ok ? 0 : 1;
    return;
  }
  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(values.markdown ? renderMarkdown(result, splits) : renderText(result, splits));
  if (values.detail) {
    process.stdout.write(renderEffortDetail(result, GATED_PREDICTOR));
  }
}

main();
