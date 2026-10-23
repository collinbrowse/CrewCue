/**
 * Evaluation harness: metrics math, predictors, and the CI accuracy gate.
 *
 * The gate test is the regression check: if a change to the pacing model moves its accuracy on the
 * committed corpus, this fails until the change is justified and the baseline re-recorded with
 * `npm run pacing:eval -w @crewcue/api -- --write-baseline`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { estimatePacingDeterministic } from "../deterministicEstimator.js";
import { loadEvaluationCorpus, type LoadedEffort } from "./corpus.js";
import {
  buildMetricsBaseline,
  checkAgainstBaseline,
  GATE_TOLERANCE_PCT_POINTS,
  runEvaluation,
  type MetricsBaseline
} from "./evaluate.js";
import { classifyTerrain, progressThird, scoreEffort, summarize } from "./metrics.js";
import { EVALUATION_PREDICTORS, prepareEffort } from "./predictors.js";
import { renderGate, renderMarkdown } from "./report.js";
import { evaluationCorpusDir, findPacingFixturesDir } from "./testSupport.js";

const CORPUS_DIR = evaluationCorpusDir();
const COURSE_GPX = readFileSync(resolve(findPacingFixturesDir(), "course-50k-with-aids.gpx"), "utf8");

function handEffort(actualSplits: LoadedEffort["actualSplits"]): LoadedEffort {
  return {
    schemaVersion: 1,
    id: "hand-50k",
    group: "hand",
    provenance: { kind: "synthetic", generator: "test", seed: "test", note: "hand-built" },
    course: "../course-50k-with-aids.gpx",
    raceStartAt: "2026-08-15T13:00:00.000Z",
    history: [],
    actualSplits,
    split: "tune",
    courseGpxXml: COURSE_GPX
  };
}

test("classifyTerrain and progressThird bucket boundaries", () => {
  assert.equal(classifyTerrain(0, 0), "flat");
  assert.equal(classifyTerrain(12, 9), "rolling");
  assert.equal(classifyTerrain(40, 10), "climbing");
  assert.equal(classifyTerrain(10, 40), "descending");
  assert.equal(classifyTerrain(40, 40), "rolling");
  assert.equal(progressThird(10, 90), "early");
  assert.equal(progressThird(45, 90), "middle");
  assert.equal(progressThird(80, 90), "late");
});

test("scoreEffort computes signed, percent, shape and segment errors from the same numbers", () => {
  const prepared = prepareEffort(
    handEffort([
      { checkpointId: "aid-1", actualElapsedSeconds: 4000 },
      { checkpointId: "finish", actualElapsedSeconds: 20000 }
    ])
  );
  const aid1 = prepared.scoredCheckpoints.find((checkpoint) => checkpoint.checkpointId === "aid-1")!;
  const prediction = {
    elapsedByCheckpoint: new Map([
      ["aid-1", 5000],
      ["aid-2", 9000],
      ["finish", 25000]
    ]),
    finishElapsedSeconds: 25000
  };
  const score = scoreEffort(prepared, "even-pace", prediction);

  // aid-2/aid-3 have no actual split, so only aid-1 and finish are scored.
  assert.deepEqual(score.checkpoints.map((row) => row.checkpointId), ["aid-1", "finish"]);
  assert.equal(score.finish.errorSeconds, 5000);
  assert.equal(score.finish.percentError, 25);
  assert.equal(score.checkpoints[0]!.percentError, 25);
  // Shape: 5000 × (20000 / 25000) = 4000 → exact match.
  assert.equal(score.checkpoints[0]!.shapePercentError, 0);

  assert.equal(score.segments.length, 2);
  assert.equal(score.segments[0]!.lengthMeters, aid1.distanceMetersFromStart);
  assert.equal(score.segments[1]!.predictedSeconds, 20000);
  assert.equal(score.segments[1]!.actualSeconds, 16000);
  assert.equal(score.segments[1]!.percentError, 25);

  const summary = summarize([score]);
  assert.equal(summary.finish.mapePct, 25);
  assert.equal(summary.finish.biasMinutes, 5000 / 60);
  assert.equal(summary.finish.within10PctShare, 0);
  assert.equal(summary.shape.n, 1);
  assert.equal(summary.shape.mapePct, 0);
  // aid-1 is 1000 s (≈17 min) late, the finish 83 min late.
  assert.equal(summary.checkpoints.within15MinShare, 0);
  assert.equal(summary.checkpoints.within30MinShare, 0.5);
});

test("even-pace baseline is the legacy deterministic estimator", () => {
  const effort = loadEvaluationCorpus(CORPUS_DIR).find((row) => row.id === "fixture-50k-a01")!;
  const prepared = prepareEffort(effort);
  const evenPace = EVALUATION_PREDICTORS.find((predictor) => predictor.id === "even-pace")!;
  const legacy = estimatePacingDeterministic({
    raceStartAt: prepared.inputs.raceStartAt,
    checkpoints: prepared.inputs.checkpoints,
    history: prepared.inputs.history
  });
  const farthest = Math.max(...prepared.inputs.checkpoints.map((cp) => cp.distanceMetersFromStart ?? 0));
  const prediction = evenPace.predict(prepared);
  assert.ok(
    Math.abs(prediction.finishElapsedSeconds - legacy.expectedFinishElapsedSeconds * (prepared.courseLengthMeters / farthest)) < 1e-6
  );
});

test("every predictor returns a positive, non-decreasing prediction for every corpus effort", () => {
  const efforts = loadEvaluationCorpus(CORPUS_DIR);
  for (const predictor of EVALUATION_PREDICTORS) {
    for (const effort of efforts) {
      const prepared = prepareEffort(effort);
      const prediction = predictor.predict(prepared);
      let previous = 0;
      for (const checkpoint of prepared.scoredCheckpoints) {
        const value = prediction.elapsedByCheckpoint.get(checkpoint.checkpointId);
        assert.ok(value !== undefined && value > previous, `${predictor.id} ${effort.id} ${checkpoint.checkpointId}`);
        previous = value;
      }
      assert.equal(prediction.elapsedByCheckpoint.get("finish"), prediction.finishElapsedSeconds);
    }
  }
});

test("accuracy gate: micro-model matches fixtures/pacing/eval/metrics-baseline.json", () => {
  const result = runEvaluation(loadEvaluationCorpus(CORPUS_DIR));
  const baseline = JSON.parse(readFileSync(resolve(CORPUS_DIR, "metrics-baseline.json"), "utf8")) as MetricsBaseline;
  const outcome = checkAgainstBaseline(result, baseline);
  assert.ok(outcome.ok, renderGate(outcome));
  assert.match(renderMarkdown(result, ["holdout"]), /Micro-model \(production\)/);
});

test("gate fails on regression, on unrecorded improvement, and on a changed corpus", () => {
  const result = runEvaluation(loadEvaluationCorpus(CORPUS_DIR).slice(0, 10));
  const baseline = buildMetricsBaseline(result);
  assert.ok(checkAgainstBaseline(result, baseline).ok);

  const worse: MetricsBaseline = structuredClone(baseline);
  worse.metrics.all!["finish.mapePct"] = worse.metrics.all!["finish.mapePct"]! - GATE_TOLERANCE_PCT_POINTS * 3;
  const regressed = checkAgainstBaseline(result, worse);
  assert.equal(regressed.ok, false);
  assert.equal(regressed.regressions[0]!.metric, "finish.mapePct");

  const better: MetricsBaseline = structuredClone(baseline);
  better.metrics.all!["shape.mapePct"] = better.metrics.all!["shape.mapePct"]! + GATE_TOLERANCE_PCT_POINTS * 3;
  const improved = checkAgainstBaseline(result, better);
  assert.equal(improved.ok, false);
  assert.equal(improved.improvements[0]!.metric, "shape.mapePct");

  const withinNoise: MetricsBaseline = structuredClone(baseline);
  withinNoise.metrics.all!["finish.mapePct"] = withinNoise.metrics.all!["finish.mapePct"]! - GATE_TOLERANCE_PCT_POINTS / 2;
  assert.ok(checkAgainstBaseline(result, withinNoise).ok);

  const moved = checkAgainstBaseline(result, { ...baseline, corpusFingerprint: "different" });
  assert.equal(moved.ok, false);
  assert.equal(moved.corpusChanged, true);
});
