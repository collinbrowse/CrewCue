/**
 * Error metrics for the pacing evaluation harness.
 *
 * Errors are signed `predicted − actual` (positive = model too slow / arrival predicted late).
 * Percent errors are primary because efforts range from a marathon to 100 miles; absolute minutes
 * are reported alongside for intuition.
 *
 * Three views separate the two ways a pacing model can be wrong:
 * - finish / checkpoints: what the racer and crew actually see.
 * - shape: predictions rescaled so the finish matches the actual finish. Isolates how time is
 *   distributed along the course (terrain + fatigue) from the overall level (fitness + endurance).
 * - segments: aid-to-aid durations bucketed by terrain and race progress, to locate which part
 *   of the model (grade cost, descent, fatigue) is responsible.
 */
import { smoothElevations, type SmoothedElevationSample } from "@crewcue/map-core";
import type { EvaluationSplit } from "./corpus.js";
import type { Prediction, PredictorId, PreparedEffort } from "./predictors.js";

export type TerrainClass = "flat" | "rolling" | "climbing" | "descending";
export type ProgressThird = "early" | "middle" | "late";

export const TERRAIN_CLASSES: readonly TerrainClass[] = ["flat", "rolling", "climbing", "descending"];
export const PROGRESS_THIRDS: readonly ProgressThird[] = ["early", "middle", "late"];

/** Segment terrain thresholds (meters of climb or descent per km of segment). */
const DIRECTIONAL_METERS_PER_KM = 25;
const DIRECTIONAL_DOMINANCE = 1.5;
const ROLLING_METERS_PER_KM = 20;

export type CheckpointScore = {
  checkpointId: string;
  distanceMetersFromStart: number;
  predictedSeconds: number;
  actualSeconds: number;
  errorSeconds: number;
  percentError: number;
  /** Percent error after scaling the prediction so its finish equals the actual finish. */
  shapePercentError: number;
};

export type SegmentScore = {
  fromCheckpointId: string;
  toCheckpointId: string;
  lengthMeters: number;
  gainMetersPerKm: number;
  lossMetersPerKm: number;
  terrain: TerrainClass;
  progress: ProgressThird;
  predictedSeconds: number;
  actualSeconds: number;
  percentError: number;
};

export type EffortScore = {
  effortId: string;
  group: string;
  split: EvaluationSplit;
  provenanceKind: string;
  predictorId: PredictorId;
  courseLengthMeters: number;
  finish: CheckpointScore;
  /** Every scored checkpoint with an actual split, finish included (last). */
  checkpoints: CheckpointScore[];
  segments: SegmentScore[];
};

export type ErrorBucket = { n: number; mapePct: number; biasPct: number };

export type SummaryMetrics = {
  efforts: number;
  finish: {
    n: number;
    mapePct: number;
    biasPct: number;
    maeMinutes: number;
    biasMinutes: number;
    within5PctShare: number;
    within10PctShare: number;
  };
  checkpoints: {
    n: number;
    mapePct: number;
    biasPct: number;
    maeMinutes: number;
    within15MinShare: number;
    within30MinShare: number;
  };
  /** Finish-anchored checkpoint error (mid-course checkpoints only). */
  shape: { n: number; mapePct: number };
  segmentsByTerrain: Record<TerrainClass, ErrorBucket>;
  segmentsByProgress: Record<ProgressThird, ErrorBucket>;
};

function percentError(predicted: number, actual: number): number {
  return ((predicted - actual) / actual) * 100;
}

export function classifyTerrain(gainMetersPerKm: number, lossMetersPerKm: number): TerrainClass {
  if (gainMetersPerKm >= DIRECTIONAL_METERS_PER_KM && gainMetersPerKm >= lossMetersPerKm * DIRECTIONAL_DOMINANCE) {
    return "climbing";
  }
  if (lossMetersPerKm >= DIRECTIONAL_METERS_PER_KM && lossMetersPerKm >= gainMetersPerKm * DIRECTIONAL_DOMINANCE) {
    return "descending";
  }
  if (gainMetersPerKm + lossMetersPerKm >= ROLLING_METERS_PER_KM) {
    return "rolling";
  }
  return "flat";
}

export function progressThird(midpointMeters: number, courseLengthMeters: number): ProgressThird {
  const fraction = midpointMeters / courseLengthMeters;
  return fraction < 1 / 3 ? "early" : fraction < 2 / 3 ? "middle" : "late";
}

/** Gain and loss (m) between two distances on the smoothed course profile. */
function gainLossBetween(
  samples: SmoothedElevationSample[],
  fromMeters: number,
  toMeters: number
): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    const midpoint = (previous.distanceMetersFromStart + current.distanceMetersFromStart) / 2;
    if (midpoint < fromMeters || midpoint >= toMeters) {
      continue;
    }
    const delta = current.elevationMeters - previous.elevationMeters;
    if (delta > 0) {
      gain += delta;
    } else {
      loss -= delta;
    }
  }
  return { gain, loss };
}

export function scoreEffort(prepared: PreparedEffort, predictorId: PredictorId, prediction: Prediction): EffortScore {
  const { effort, courseLengthMeters } = prepared;
  const actualById = new Map(effort.actualSplits.map((split) => [split.checkpointId, split.actualElapsedSeconds]));
  const actualFinish = actualById.get("finish")!;
  const shapeScale = actualFinish / prediction.finishElapsedSeconds;

  const checkpoints: CheckpointScore[] = [];
  for (const checkpoint of prepared.scoredCheckpoints) {
    const actual = actualById.get(checkpoint.checkpointId);
    const predicted = prediction.elapsedByCheckpoint.get(checkpoint.checkpointId);
    if (actual === undefined || predicted === undefined) {
      continue;
    }
    checkpoints.push({
      checkpointId: checkpoint.checkpointId,
      distanceMetersFromStart: checkpoint.distanceMetersFromStart,
      predictedSeconds: predicted,
      actualSeconds: actual,
      errorSeconds: predicted - actual,
      percentError: percentError(predicted, actual),
      shapePercentError: percentError(predicted * shapeScale, actual)
    });
  }

  const samples = smoothElevations(prepared.inputs.routeMetricPoints);
  const segments: SegmentScore[] = [];
  let previous = { checkpointId: "start", distanceMetersFromStart: 0, predictedSeconds: 0, actualSeconds: 0 };
  for (const checkpoint of checkpoints) {
    const lengthMeters = checkpoint.distanceMetersFromStart - previous.distanceMetersFromStart;
    const actualSeconds = checkpoint.actualSeconds - previous.actualSeconds;
    if (lengthMeters > 0 && actualSeconds > 0) {
      const { gain, loss } = gainLossBetween(samples, previous.distanceMetersFromStart, checkpoint.distanceMetersFromStart);
      const gainMetersPerKm = (gain / lengthMeters) * 1000;
      const lossMetersPerKm = (loss / lengthMeters) * 1000;
      const predictedSeconds = checkpoint.predictedSeconds - previous.predictedSeconds;
      segments.push({
        fromCheckpointId: previous.checkpointId,
        toCheckpointId: checkpoint.checkpointId,
        lengthMeters,
        gainMetersPerKm,
        lossMetersPerKm,
        terrain: classifyTerrain(gainMetersPerKm, lossMetersPerKm),
        progress: progressThird(
          (previous.distanceMetersFromStart + checkpoint.distanceMetersFromStart) / 2,
          courseLengthMeters
        ),
        predictedSeconds,
        actualSeconds,
        percentError: percentError(predictedSeconds, actualSeconds)
      });
    }
    previous = checkpoint;
  }

  const finish = checkpoints[checkpoints.length - 1]!;
  return {
    effortId: effort.id,
    group: effort.group,
    split: effort.split,
    provenanceKind: effort.provenance.kind,
    predictorId,
    courseLengthMeters,
    finish,
    checkpoints,
    segments
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function share(values: number[], predicate: (value: number) => boolean): number {
  return values.length === 0 ? 0 : values.filter(predicate).length / values.length;
}

function bucket(percentErrors: number[]): ErrorBucket {
  return {
    n: percentErrors.length,
    mapePct: mean(percentErrors.map(Math.abs)),
    biasPct: mean(percentErrors)
  };
}

export function summarize(scores: EffortScore[]): SummaryMetrics {
  const finishes = scores.map((score) => score.finish);
  const checkpoints = scores.flatMap((score) => score.checkpoints);
  const midCourse = scores.flatMap((score) => score.checkpoints.slice(0, -1));
  const segments = scores.flatMap((score) => score.segments);

  const segmentsByTerrain = Object.fromEntries(
    TERRAIN_CLASSES.map((terrain) => [
      terrain,
      bucket(segments.filter((segment) => segment.terrain === terrain).map((segment) => segment.percentError))
    ])
  ) as Record<TerrainClass, ErrorBucket>;
  const segmentsByProgress = Object.fromEntries(
    PROGRESS_THIRDS.map((third) => [
      third,
      bucket(segments.filter((segment) => segment.progress === third).map((segment) => segment.percentError))
    ])
  ) as Record<ProgressThird, ErrorBucket>;

  const finishPct = finishes.map((row) => row.percentError);
  const checkpointMinutes = checkpoints.map((row) => row.errorSeconds / 60);
  return {
    efforts: scores.length,
    finish: {
      n: finishes.length,
      mapePct: mean(finishPct.map(Math.abs)),
      biasPct: mean(finishPct),
      maeMinutes: mean(finishes.map((row) => Math.abs(row.errorSeconds) / 60)),
      biasMinutes: mean(finishes.map((row) => row.errorSeconds / 60)),
      within5PctShare: share(finishPct, (value) => Math.abs(value) <= 5),
      within10PctShare: share(finishPct, (value) => Math.abs(value) <= 10)
    },
    checkpoints: {
      n: checkpoints.length,
      mapePct: mean(checkpoints.map((row) => Math.abs(row.percentError))),
      biasPct: mean(checkpoints.map((row) => row.percentError)),
      maeMinutes: mean(checkpointMinutes.map(Math.abs)),
      within15MinShare: share(checkpointMinutes, (value) => Math.abs(value) <= 15),
      within30MinShare: share(checkpointMinutes, (value) => Math.abs(value) <= 30)
    },
    shape: {
      n: midCourse.length,
      mapePct: mean(midCourse.map((row) => Math.abs(row.shapePercentError)))
    },
    segmentsByTerrain,
    segmentsByProgress
  };
}
