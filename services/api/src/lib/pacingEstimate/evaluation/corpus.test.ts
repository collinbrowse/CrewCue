import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assignEvaluationSplit,
  corpusFingerprint,
  EvaluationCorpusError,
  HOLDOUT_FRACTION,
  loadEvaluationCorpus,
  parseEvaluationEffort
} from "./corpus.js";
import { evaluationCorpusDir } from "./testSupport.js";

function validEffort(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "own-50k-2026",
    group: "athlete-x",
    provenance: { kind: "own-effort", contributor: "Test", consent: "own data" },
    course: "courses/c.gpx",
    raceStartAt: "2026-08-15T13:00:00.000Z",
    history: [
      {
        id: "h1",
        source: "gpx_upload",
        externalId: "gpx:h1",
        recordedAt: "2026-07-01T13:00:00.000Z",
        ingestedAt: "2026-08-01T13:00:00.000Z",
        distanceMeters: 30000,
        elapsedSeconds: 10800,
        elevationGainMeters: 600
      }
    ],
    actualSplits: [
      { checkpointId: "aid-1", actualElapsedSeconds: 3600 },
      { checkpointId: "finish", actualElapsedSeconds: 18000 }
    ],
    ...overrides
  };
}

test("parseEvaluationEffort accepts a well-formed effort", () => {
  const effort = parseEvaluationEffort(validEffort());
  assert.equal(effort.id, "own-50k-2026");
  assert.equal(effort.history.length, 1);
  assert.equal(effort.actualSplits[1]!.checkpointId, "finish");
});

test("parseEvaluationEffort rejects data that would corrupt the evaluation", () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["no finish split", { actualSplits: [{ checkpointId: "aid-1", actualElapsedSeconds: 10 }] }, /finish/],
    ["duplicate split", { actualSplits: [
      { checkpointId: "finish", actualElapsedSeconds: 10 },
      { checkpointId: "finish", actualElapsedSeconds: 11 }
    ] }, /repeats/],
    ["non-positive split", { actualSplits: [{ checkpointId: "finish", actualElapsedSeconds: 0 }] }, /positive/],
    ["unknown provenance", { provenance: { kind: "scraped" } }, /kind/],
    ["own effort without consent", { provenance: { kind: "own-effort", contributor: "x" } }, /consent/],
    ["bad id", { id: "Has Spaces" }, /kebab/],
    ["wrong schema", { schemaVersion: 2 }, /schemaVersion/],
    ["history after the race", { history: [{
      id: "late",
      source: "strava",
      externalId: "s:1",
      recordedAt: "2026-08-16T13:00:00.000Z",
      ingestedAt: "2026-08-16T13:00:00.000Z",
      distanceMeters: 1000,
      elapsedSeconds: 100
    }] }, /pre-race/]
  ];
  for (const [label, overrides, pattern] of cases) {
    assert.throws(() => parseEvaluationEffort(validEffort(overrides)), (error: unknown) => {
      assert.ok(error instanceof EvaluationCorpusError, label);
      assert.match(error.message, pattern, label);
      return true;
    });
  }
});

test("assignEvaluationSplit is stable and roughly honours HOLDOUT_FRACTION", () => {
  assert.equal(assignEvaluationSplit("athlete-x"), assignEvaluationSplit("athlete-x"));
  const groups = Array.from({ length: 2000 }, (_, index) => `athlete-${index}`);
  const holdout = groups.filter((group) => assignEvaluationSplit(group) === "holdout").length / groups.length;
  assert.ok(Math.abs(holdout - HOLDOUT_FRACTION) < 0.04, `holdout share ${holdout}`);
});

test("committed corpus loads, keeps each athlete on one side, and has both splits", () => {
  const efforts = loadEvaluationCorpus(evaluationCorpusDir());
  assert.ok(efforts.length >= 50);
  const splitByGroup = new Map<string, string>();
  for (const effort of efforts) {
    const previous = splitByGroup.get(effort.group);
    assert.ok(previous === undefined || previous === effort.split, `${effort.group} straddles splits`);
    splitByGroup.set(effort.group, effort.split);
  }
  const splits = new Set(splitByGroup.values());
  assert.deepEqual([...splits].sort(), ["holdout", "tune"]);
});

test("loadEvaluationCorpus requires file name = id and an existing course", () => {
  const root = mkdtempSync(join(tmpdir(), "pacing-eval-"));
  mkdirSync(join(root, "efforts"));
  writeFileSync(join(root, "efforts", "wrong-name.json"), JSON.stringify(validEffort()));
  assert.throws(() => loadEvaluationCorpus(root), /must match the file name/);

  const second = mkdtempSync(join(tmpdir(), "pacing-eval-"));
  mkdirSync(join(second, "efforts"));
  writeFileSync(join(second, "efforts", "own-50k-2026.json"), JSON.stringify(validEffort()));
  assert.throws(() => loadEvaluationCorpus(second), /course courses\/c.gpx not found/);
});

test("corpusFingerprint changes when an actual split changes", () => {
  const efforts = loadEvaluationCorpus(evaluationCorpusDir()).slice(0, 3);
  const before = corpusFingerprint(efforts);
  const edited = efforts.map((effort, index) =>
    index === 0
      ? { ...effort, actualSplits: effort.actualSplits.map((split) => ({ ...split, actualElapsedSeconds: split.actualElapsedSeconds + 1 })) }
      : effort
  );
  assert.notEqual(corpusFingerprint(edited), before);
  assert.equal(corpusFingerprint([...efforts].reverse()), before);
});
