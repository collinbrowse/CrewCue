/**
 * Offline pacing backtest harness (docs/sdlc/pacing-accuracy-program.md, PR B).
 *
 * Given a course GPX, the athlete's summary history, and their ACTUAL splits, run the micro-model
 * estimator directly (no HTTP, deterministic) and report predicted vs actual moving elapsed per
 * aid and at the finish, with signed error and mean absolute error. This is what makes PR C's
 * model tuning measurable without spending a real race.
 *
 * Convention: `actualElapsedSeconds` is MOVING elapsed from the start (aid dwell excluded), so the
 * report isolates pace-model error from station dwell (which PR D handles separately).
 */
import {
  parseActivityHistoryRef,
  type ActivityHistoryRef,
  type RaceCourseCheckpoint
} from "@crewcue/contracts";
import {
  buildDerivedMetricsFromPolyline,
  buildRaceCourseFromGpx,
  checkpointsWithProjectedDistances,
  parseGpxTrack,
  type CourseMetricPoint
} from "@crewcue/map-core";
import { estimatePacingMicroModelWithArtifacts, type MicroModelEstimateInput } from "./index.js";
import { interpolateElapsedAtDistance } from "./microModel/simulate.js";

/** Finish-line checkpoint id (GPX "Finish" waypoint sanitizes to this). */
const FINISH_ID = "finish";

export type BacktestActualSplit = {
  /** Checkpoint id (e.g. "aid-1") or "finish". */
  checkpointId: string;
  /** Actual MOVING elapsed from the start at this checkpoint (dwell excluded), in seconds. */
  actualElapsedSeconds: number;
};

export type BacktestScenario = {
  name: string;
  raceStartAt: string;
  /** Raw course GPX: waypoints become checkpoints, trackpoints become the route polyline. */
  courseGpxXml: string;
  /** Athlete summary history rows (distance / elapsed / elevationGain). Empty = cold start. */
  history: ActivityHistoryRef[];
  actualSplits: BacktestActualSplit[];
  seed?: string;
};

export type BacktestRow = {
  checkpointId: string;
  label: string;
  distanceMetersFromStart: number;
  predictedElapsedSeconds: number;
  actualElapsedSeconds: number | null;
  /** predicted − actual (positive = model predicts a slower arrival). null when no actual given. */
  signedErrorSeconds: number | null;
};

export type BacktestResult = {
  name: string;
  coldStart: boolean;
  explanation: string;
  courseLengthMeters: number;
  rows: BacktestRow[];
  finishPredictedElapsedSeconds: number;
  finishActualElapsedSeconds: number | null;
  finishSignedErrorSeconds: number | null;
  /** Mean absolute error over rows (incl. finish) that have an actual split. */
  meanAbsoluteErrorSeconds: number;
  /** Number of rows contributing to MAE. */
  scoredRowCount: number;
};

/**
 * Build the exact micro-model inputs a course GPX implies (route polyline, snapped checkpoints,
 * canonical length, parsed history). Shared by {@link runPacingBacktest} and tests so predicted
 * numbers are recomputed from the same inputs the code uses rather than blessed golden values.
 */
export function buildBacktestInputs(scenario: BacktestScenario): MicroModelEstimateInput {
  const parsed = parseGpxTrack(scenario.courseGpxXml);
  const routeMetricPoints: CourseMetricPoint[] = parsed.points.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    elevationMeters: point.elevationMeters
  }));
  const { course } = buildRaceCourseFromGpx(parsed);
  const checkpoints: RaceCourseCheckpoint[] = checkpointsWithProjectedDistances(
    course.checkpoints,
    routeMetricPoints
  );
  const courseLengthMeters = buildDerivedMetricsFromPolyline(routeMetricPoints).canonicalDistanceMeters;
  const history = scenario.history.map((row) => parseActivityHistoryRef(row));
  return {
    raceStartAt: scenario.raceStartAt,
    checkpoints,
    history,
    ...(scenario.seed !== undefined ? { seed: scenario.seed } : {}),
    routeMetricPoints,
    courseLengthMeters
  };
}

export function runPacingBacktest(scenario: BacktestScenario): BacktestResult {
  const inputs = buildBacktestInputs(scenario);
  const artifacts = estimatePacingMicroModelWithArtifacts(inputs);
  const baselineCurve = artifacts.baselineTrack.points;
  const courseLengthMeters = artifacts.courseLengthMeters;

  const actualByCheckpoint = new Map<string, number>();
  for (const split of scenario.actualSplits) {
    actualByCheckpoint.set(split.checkpointId, split.actualElapsedSeconds);
  }

  const predictedAt = (distanceMeters: number): number =>
    Math.max(0, Math.round(interpolateElapsedAtDistance(baselineCurve, distanceMeters)));

  const rows: BacktestRow[] = [];
  const absoluteErrors: number[] = [];

  for (const checkpoint of inputs.checkpoints) {
    const distance = checkpoint.distanceMetersFromStart ?? 0;
    // Skip the start line: no travel yet, nothing to score.
    if (distance <= 0) {
      continue;
    }
    const isFinish = checkpoint.id === FINISH_ID || distance >= courseLengthMeters - 1;
    const predicted = isFinish
      ? artifacts.estimate.expectedFinishElapsedSeconds
      : predictedAt(distance);
    const actual =
      actualByCheckpoint.get(checkpoint.id) ??
      (isFinish ? actualByCheckpoint.get(FINISH_ID) : undefined);
    const signedError = actual === undefined ? null : predicted - actual;
    if (signedError !== null) {
      absoluteErrors.push(Math.abs(signedError));
    }
    rows.push({
      checkpointId: checkpoint.id,
      label: checkpoint.title ?? checkpoint.id,
      distanceMetersFromStart: distance,
      predictedElapsedSeconds: predicted,
      actualElapsedSeconds: actual ?? null,
      signedErrorSeconds: signedError
    });
  }

  const finishPredicted = artifacts.estimate.expectedFinishElapsedSeconds;
  const finishActual = actualByCheckpoint.get(FINISH_ID) ?? null;
  const finishSignedError = finishActual === null ? null : finishPredicted - finishActual;
  const meanAbsoluteErrorSeconds =
    absoluteErrors.length > 0
      ? absoluteErrors.reduce((sum, value) => sum + value, 0) / absoluteErrors.length
      : 0;

  return {
    name: scenario.name,
    coldStart: artifacts.estimate.coldStart,
    explanation: artifacts.estimate.explanation,
    courseLengthMeters,
    rows,
    finishPredictedElapsedSeconds: finishPredicted,
    finishActualElapsedSeconds: finishActual,
    finishSignedErrorSeconds: finishSignedError,
    meanAbsoluteErrorSeconds,
    scoredRowCount: absoluteErrors.length
  };
}
