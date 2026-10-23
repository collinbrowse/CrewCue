/**
 * PR B — offline backtest harness (docs/sdlc/pacing-accuracy-program.md).
 *
 * Expectations are recomputed from the same inputs the harness uses (never blessed golden numbers),
 * per the program's "pin magnitudes" trap.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActivityHistoryRef } from "@crewcue/contracts";
import {
  buildBacktestInputs,
  runPacingBacktest,
  type BacktestScenario
} from "./backtest.js";
import { estimatePacingMicroModelWithArtifacts } from "./index.js";
import { interpolateElapsedAtDistance } from "./microModel/simulate.js";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "course-50k-with-aids.gpx"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing/course-50k-with-aids.gpx not found");
}

const FIXTURES_DIR = findPacingFixturesDir();
const COURSE_GPX = readFileSync(resolve(FIXTURES_DIR, "course-50k-with-aids.gpx"), "utf8");
const RACE_START_AT = "2026-08-15T13:00:00.000Z";

function historyRow(overrides: Partial<ActivityHistoryRef> & { id: string }): ActivityHistoryRef {
  return {
    source: "gpx_upload",
    externalId: `gpx:${overrides.id}`,
    recordedAt: "2026-06-01T14:00:00.000Z",
    ingestedAt: "2026-08-01T09:00:00.000Z",
    distanceMeters: 45000,
    elapsedSeconds: 21600,
    elevationGainMeters: 1500,
    ...overrides
  };
}

function scenarioFromFixture(): BacktestScenario {
  const raw = JSON.parse(readFileSync(resolve(FIXTURES_DIR, "backtest-50k-example.json"), "utf8")) as {
    name: string;
    raceStartAt: string;
    seed?: string;
    history: ActivityHistoryRef[];
    actualSplits: BacktestScenario["actualSplits"];
  };
  return {
    name: raw.name,
    raceStartAt: raw.raceStartAt,
    courseGpxXml: COURSE_GPX,
    history: raw.history,
    actualSplits: raw.actualSplits,
    ...(raw.seed !== undefined ? { seed: raw.seed } : {})
  };
}

test("harness reports the estimator's own predicted moving times (wiring, not golden numbers)", () => {
  const scenario = scenarioFromFixture();
  const result = runPacingBacktest(scenario);

  const inputs = buildBacktestInputs(scenario);
  const artifacts = estimatePacingMicroModelWithArtifacts(inputs);

  // Finish prediction is the estimator's expected finish.
  assert.equal(result.finishPredictedElapsedSeconds, artifacts.estimate.expectedFinishElapsedSeconds);
  assert.equal(result.coldStart, artifacts.estimate.coldStart);
  assert.equal(result.coldStart, false); // fixture has history

  // Each row's predicted value is recomputed the same way the harness derives it.
  for (const row of result.rows) {
    const isFinish = row.checkpointId === "finish" || row.distanceMetersFromStart >= result.courseLengthMeters - 1;
    const expected = isFinish
      ? artifacts.estimate.expectedFinishElapsedSeconds
      : Math.max(0, Math.round(interpolateElapsedAtDistance(artifacts.baselineTrack.points, row.distanceMetersFromStart)));
    assert.equal(row.predictedElapsedSeconds, expected, `predicted mismatch for ${row.checkpointId}`);
  }
});

test("harness excludes the start line and keeps checkpoints in increasing distance/prediction order", () => {
  const result = runPacingBacktest(scenarioFromFixture());
  assert.ok(result.rows.length >= 4, "aid-1/2/3 + finish expected");
  assert.ok(
    result.rows.every((row) => row.distanceMetersFromStart > 0),
    "start line (distance 0) must be excluded"
  );
  for (let i = 1; i < result.rows.length; i += 1) {
    assert.ok(
      result.rows[i]!.distanceMetersFromStart > result.rows[i - 1]!.distanceMetersFromStart,
      "rows must be ordered by distance"
    );
    assert.ok(
      result.rows[i]!.predictedElapsedSeconds >= result.rows[i - 1]!.predictedElapsedSeconds,
      "predicted elapsed must be monotonic non-decreasing"
    );
  }
});

test("MAE equals the mean absolute signed error over scored rows", () => {
  const result = runPacingBacktest(scenarioFromFixture());
  const scored = result.rows.filter((row) => row.signedErrorSeconds !== null);
  assert.equal(result.scoredRowCount, scored.length);
  assert.ok(scored.length >= 1);
  const expectedMae =
    scored.reduce((sum, row) => sum + Math.abs(row.signedErrorSeconds as number), 0) / scored.length;
  assert.ok(Math.abs(result.meanAbsoluteErrorSeconds - expectedMae) < 1e-9);
  // Signed error is predicted − actual.
  for (const row of scored) {
    assert.equal(row.signedErrorSeconds, row.predictedElapsedSeconds - (row.actualElapsedSeconds as number));
  }
});

test("deterministic: identical inputs produce identical predictions", () => {
  const a = runPacingBacktest(scenarioFromFixture());
  const b = runPacingBacktest(scenarioFromFixture());
  assert.equal(a.finishPredictedElapsedSeconds, b.finishPredictedElapsedSeconds);
  assert.equal(a.meanAbsoluteErrorSeconds, b.meanAbsoluteErrorSeconds);
  assert.deepEqual(
    a.rows.map((r) => r.predictedElapsedSeconds),
    b.rows.map((r) => r.predictedElapsedSeconds)
  );
});

test("no history yields a cold-start prediction distinct from the history-backed one", () => {
  const withHistory = runPacingBacktest(scenarioFromFixture());
  const coldStart = runPacingBacktest({
    ...scenarioFromFixture(),
    history: []
  });
  assert.equal(coldStart.coldStart, true);
  assert.notEqual(coldStart.finishPredictedElapsedSeconds, withHistory.finishPredictedElapsedSeconds);
});

test("materially different history produces materially different finish predictions", () => {
  const base = scenarioFromFixture();
  const fast = runPacingBacktest({
    ...base,
    name: "fast athlete",
    history: [historyRow({ id: "fast", distanceMeters: 45000, elapsedSeconds: 16200 })] // ~6:00/km
  });
  const slow = runPacingBacktest({
    ...base,
    name: "slow athlete",
    history: [historyRow({ id: "slow", distanceMeters: 45000, elapsedSeconds: 27000 })] // ~10:00/km
  });
  assert.equal(fast.coldStart, false);
  assert.equal(slow.coldStart, false);
  assert.ok(
    fast.finishPredictedElapsedSeconds < slow.finishPredictedElapsedSeconds,
    "faster history must predict an earlier finish"
  );
});
