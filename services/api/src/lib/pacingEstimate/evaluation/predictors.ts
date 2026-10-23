/**
 * Predictors scored by the evaluation harness: the production micro-model plus baselines that a
 * pacing model has to beat to be worth its complexity.
 *
 * Every predictor sees the same inputs (course GPX → checkpoints + route, pre-race history) and
 * returns MOVING elapsed seconds at each scored checkpoint and at the finish.
 */
import type { ActivityHistoryRef } from "@crewcue/contracts";
import { buildPlanBaselineFromModel } from "@crewcue/map-core";
import { buildBacktestInputs, runPacingBacktest, type BacktestScenario } from "../backtest.js";
import { estimatePacingDeterministic } from "../deterministicEstimator.js";
import type { MicroModelEstimateInput } from "../microModel/microModelEstimator.js";
import { interpolateElapsedAtDistance } from "../microModel/simulate.js";
import type { LoadedEffort } from "./corpus.js";

export type PredictorId = "micro-model" | "even-pace" | "riegel" | "app-default";

export type ScoredCheckpoint = {
  checkpointId: string;
  distanceMetersFromStart: number;
};

export type PreparedEffort = {
  effort: LoadedEffort;
  inputs: MicroModelEstimateInput;
  courseLengthMeters: number;
  /** Checkpoints past the start, in course order (the finish is the last one). */
  scoredCheckpoints: ScoredCheckpoint[];
};

export type Prediction = {
  /** Predicted moving elapsed (s) by checkpoint id; the finish is under `finish`. */
  elapsedByCheckpoint: Map<string, number>;
  finishElapsedSeconds: number;
};

export type Predictor = {
  id: PredictorId;
  label: string;
  description: string;
  predict(prepared: PreparedEffort): Prediction;
};

/** Textbook Riegel exponent: T2 = T1 · (D2 / D1)^1.06. */
export const RIEGEL_TEXTBOOK_EXPONENT = 1.06;
/** What the app plans with when no estimate is attached (map-core DEFAULT_PACE_SECONDS_PER_KM). */
export const APP_DEFAULT_PACE_SECONDS_PER_KM = 360;
const FINISH_ID = "finish";

function scenarioOf(effort: LoadedEffort): BacktestScenario {
  return {
    name: effort.id,
    raceStartAt: effort.raceStartAt,
    courseGpxXml: effort.courseGpxXml,
    history: effort.history,
    actualSplits: effort.actualSplits
  };
}

export function prepareEffort(effort: LoadedEffort): PreparedEffort {
  const inputs = buildBacktestInputs(scenarioOf(effort));
  const courseLengthMeters = inputs.courseLengthMeters ?? 0;
  const ordered = inputs.checkpoints
    .map((checkpoint) => ({
      checkpointId: checkpoint.id,
      distanceMetersFromStart: checkpoint.distanceMetersFromStart ?? 0
    }))
    .filter((checkpoint) => checkpoint.distanceMetersFromStart > 0);
  // The finish is scored at the course length under the id `finish`, whatever its waypoint id.
  const scoredCheckpoints = ordered
    .filter((checkpoint) => checkpoint.checkpointId !== FINISH_ID && checkpoint.distanceMetersFromStart < courseLengthMeters - 1)
    .concat([{ checkpointId: FINISH_ID, distanceMetersFromStart: courseLengthMeters }]);
  return { effort, inputs, courseLengthMeters, scoredCheckpoints };
}

function predictionFromPace(prepared: PreparedEffort, finishElapsedSeconds: number): Prediction {
  const secondsPerMeter = finishElapsedSeconds / prepared.courseLengthMeters;
  const elapsedByCheckpoint = new Map<string, number>();
  for (const checkpoint of prepared.scoredCheckpoints) {
    elapsedByCheckpoint.set(checkpoint.checkpointId, checkpoint.distanceMetersFromStart * secondsPerMeter);
  }
  elapsedByCheckpoint.set(FINISH_ID, finishElapsedSeconds);
  return { elapsedByCheckpoint, finishElapsedSeconds };
}

function predictionFromCurve(
  prepared: PreparedEffort,
  curve: Array<{ distanceMetersFromStart: number; referenceElapsedSeconds: number }>,
  finishElapsedSeconds: number
): Prediction {
  const elapsedByCheckpoint = new Map<string, number>();
  for (const checkpoint of prepared.scoredCheckpoints) {
    elapsedByCheckpoint.set(
      checkpoint.checkpointId,
      interpolateElapsedAtDistance(curve, checkpoint.distanceMetersFromStart)
    );
  }
  elapsedByCheckpoint.set(FINISH_ID, finishElapsedSeconds);
  return { elapsedByCheckpoint, finishElapsedSeconds };
}

/** Production path: exactly what `npm run pacing:backtest` scores (micro-model expected scenario). */
const microModel: Predictor = {
  id: "micro-model",
  label: "Micro-model (production)",
  description: "estimatePacingMicroModelWithArtifacts via runPacingBacktest: C1–C4 with current constants.",
  predict(prepared) {
    const result = runPacingBacktest(scenarioOf(prepared.effort));
    const predictedById = new Map(result.rows.map((row) => [row.checkpointId, row.predictedElapsedSeconds]));
    const elapsedByCheckpoint = new Map<string, number>();
    for (const checkpoint of prepared.scoredCheckpoints) {
      const predicted = predictedById.get(checkpoint.checkpointId);
      if (predicted !== undefined) {
        elapsedByCheckpoint.set(checkpoint.checkpointId, predicted);
      }
    }
    elapsedByCheckpoint.set(FINISH_ID, result.finishPredictedElapsedSeconds);
    return { elapsedByCheckpoint, finishElapsedSeconds: result.finishPredictedElapsedSeconds };
  }
};

/** Legacy deterministic estimator: history mean pace × distance, terrain-blind. */
const evenPace: Predictor = {
  id: "even-pace",
  label: "Even pace (history mean)",
  description: "estimatePacingDeterministic: distance-weighted mean history pace, flat across the course.",
  predict(prepared) {
    const estimate = estimatePacingDeterministic({
      raceStartAt: prepared.inputs.raceStartAt,
      checkpoints: prepared.inputs.checkpoints,
      history: prepared.inputs.history
    });
    // The legacy estimator measures the course by its farthest checkpoint; rescale to route length.
    const farthest = Math.max(...prepared.inputs.checkpoints.map((cp) => cp.distanceMetersFromStart ?? 0));
    const finish = estimate.expectedFinishElapsedSeconds * (prepared.courseLengthMeters / farthest);
    return predictionFromPace(prepared, finish);
  }
};

function usableHistory(history: ActivityHistoryRef[]): Array<{ distance: number; elapsed: number }> {
  return history
    .filter((row) => (row.distanceMeters ?? 0) >= 5000 && (row.elapsedSeconds ?? 0) > 0)
    .map((row) => ({ distance: row.distanceMeters as number, elapsed: row.elapsedSeconds as number }));
}

/** Riegel only: mean history pace scaled to the course distance with the textbook exponent. */
const riegel: Predictor = {
  id: "riegel",
  label: "Riegel 1.06 (no terrain)",
  description:
    "Mean history pace at the distance-weighted reference length, scaled by (D/Dref)^0.06; even split, terrain-blind.",
  predict(prepared) {
    const rows = usableHistory(prepared.inputs.history);
    if (rows.length === 0) {
      return predictionFromPace(prepared, (prepared.courseLengthMeters / 1000) * APP_DEFAULT_PACE_SECONDS_PER_KM);
    }
    let distanceSum = 0;
    let distanceSquaredSum = 0;
    let elapsedSum = 0;
    for (const row of rows) {
      distanceSum += row.distance;
      distanceSquaredSum += row.distance * row.distance;
      elapsedSum += row.elapsed;
    }
    const pace = elapsedSum / distanceSum;
    const referenceDistance = distanceSquaredSum / distanceSum;
    const finish =
      pace * referenceDistance * Math.pow(prepared.courseLengthMeters / referenceDistance, RIEGEL_TEXTBOOK_EXPONENT);
    return predictionFromPace(prepared, finish);
  }
};

/** What racers saw in the field before an estimate was attached: 6:00/km + climb heuristic. */
const appDefault: Predictor = {
  id: "app-default",
  label: "App default (6:00/km + climb)",
  description: "map-core buildPlanBaselineFromModel at the 6:00/km default; ignores history.",
  predict(prepared) {
    const baseline = buildPlanBaselineFromModel(prepared.inputs.routeMetricPoints, APP_DEFAULT_PACE_SECONDS_PER_KM);
    const curve = baseline?.points ?? [];
    const finish = interpolateElapsedAtDistance(curve, prepared.courseLengthMeters);
    return predictionFromCurve(prepared, curve, finish);
  }
};

export const EVALUATION_PREDICTORS: readonly Predictor[] = [microModel, evenPace, riegel, appDefault];
