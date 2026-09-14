/**
 * Build a pacing backtest scenario from real GPX files (course + timed race + training).
 * Stoppage (never “dwell”): time is excluded from moving elapsed only when BOTH
 * (1) the athlete is within AID_NEAR_METERS of an aid and (2) they are stopped or
 * slower than ~30 min/mi.
 */
import type { ActivityHistoryRef, RaceCourseCheckpoint } from "@crewcue/contracts";
import {
  buildRaceCourseFromGpx,
  checkpointsWithProjectedDistances,
  parseGpxActivityTrack,
  parseGpxTrack,
  type CourseMetricPoint,
  type GpxTrackPoint
} from "@crewcue/map-core";
import { fingerprintGpxExternalId, parseGpxActivityMetrics } from "../gpxActivityHistory.js";
import type { BacktestActualSplit, BacktestScenario } from "./backtest.js";

/** Horizontal radius (meters) for “near an aid”. */
export const AID_NEAR_METERS = 75;

const METERS_PER_MILE = 1609.344;
/** 30 min/mi → meters per second. Slower than this (or no movement) may be stoppage. */
export const STOPPAGE_MAX_SPEED_METERS_PER_SEC = METERS_PER_MILE / (30 * 60);

const FINISH_ID = "finish";
const EARTH_RADIUS_METERS = 6_371_000;

export type GpxBacktestErrorCode =
  | "race_missing_timestamps"
  | "history_missing_elapsed"
  | "aid_not_visited";

export class GpxBacktestError extends Error {
  readonly code: GpxBacktestErrorCode;

  constructor(code: GpxBacktestErrorCode, message: string) {
    super(message);
    this.name = "GpxBacktestError";
    this.code = code;
  }
}

export type TimedPoint = {
  latitude: number;
  longitude: number;
  timestampMs: number;
};

export type LatLon = {
  latitude: number;
  longitude: number;
};

export function haversineMeters(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function minDistanceToAids(point: LatLon, aids: LatLon[]): number {
  if (aids.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let min = Number.POSITIVE_INFINITY;
  for (const aid of aids) {
    const meters = haversineMeters(point, aid);
    if (meters < min) {
      min = meters;
    }
  }
  return min;
}

/** True when a GPX segment is near an aid AND slow enough to count as stoppage. */
export function isStoppageSegment(from: TimedPoint, to: TimedPoint, aids: LatLon[]): boolean {
  const dtSeconds = (to.timestampMs - from.timestampMs) / 1000;
  if (!(dtSeconds > 0)) {
    return false;
  }
  const dist = haversineMeters(from, to);
  const speed = dist / dtSeconds;
  const slow = dist < 0.5 || speed <= STOPPAGE_MAX_SPEED_METERS_PER_SEC;
  const near = Math.min(minDistanceToAids(from, aids), minDistanceToAids(to, aids)) <= AID_NEAR_METERS;
  return slow && near;
}

function scoringCheckpoints(checkpoints: RaceCourseCheckpoint[]): RaceCourseCheckpoint[] {
  return checkpoints.filter((checkpoint) => (checkpoint.distanceMetersFromStart ?? 0) > 0);
}

function aidLocations(checkpoints: RaceCourseCheckpoint[]): LatLon[] {
  return checkpoints.map((checkpoint) => ({
    latitude: checkpoint.latitude,
    longitude: checkpoint.longitude
  }));
}

/**
 * First time each scoring checkpoint is entered (75 m), moving elapsed excludes prior stoppage.
 * @throws {GpxBacktestError} if timestamps are missing or a scoring aid is never visited
 */
export function extractMovingSplitsFromTimedPoints(
  points: TimedPoint[],
  checkpoints: RaceCourseCheckpoint[]
): BacktestActualSplit[] {
  if (points.length < 2) {
    throw new GpxBacktestError(
      "race_missing_timestamps",
      "Race GPX must include timestamps on track points (at least two timed points). Export a timed activity GPX and try again."
    );
  }

  const sorted = [...points].sort((a, b) => a.timestampMs - b.timestampMs);
  const startMs = sorted[0]!.timestampMs;
  const targets = scoringCheckpoints(checkpoints);
  const aids = aidLocations(checkpoints);
  const arrivalMs = new Map<string, number>();
  const movingAtArrival = new Map<string, number>();

  const considerArrival = (point: TimedPoint, stoppageSeconds: number): void => {
    const clockElapsed = (point.timestampMs - startMs) / 1000;
    for (const checkpoint of targets) {
      if (arrivalMs.has(checkpoint.id)) {
        continue;
      }
      if (haversineMeters(point, checkpoint) <= AID_NEAR_METERS) {
        arrivalMs.set(checkpoint.id, point.timestampMs);
        movingAtArrival.set(checkpoint.id, Math.max(0, Math.round(clockElapsed - stoppageSeconds)));
      }
    }
  };

  let stoppageSeconds = 0;
  considerArrival(sorted[0]!, 0);

  for (let i = 1; i < sorted.length; i += 1) {
    const from = sorted[i - 1]!;
    const to = sorted[i]!;
    if (isStoppageSegment(from, to, aids)) {
      stoppageSeconds += (to.timestampMs - from.timestampMs) / 1000;
    }
    considerArrival(to, stoppageSeconds);
  }

  const missing = targets.filter((checkpoint) => !arrivalMs.has(checkpoint.id));
  if (missing.length > 0) {
    const labels = missing.map((checkpoint) => checkpoint.title ?? checkpoint.id).join(", ");
    throw new GpxBacktestError(
      "aid_not_visited",
      `Race track never came within ${AID_NEAR_METERS} m of: ${labels}. Check that the race GPX is the same course.`
    );
  }

  return targets.map((checkpoint) => {
    const id = checkpoint.id === FINISH_ID ? FINISH_ID : checkpoint.id;
    return {
      checkpointId: id,
      actualElapsedSeconds: movingAtArrival.get(checkpoint.id)!
    };
  });
}

function timedPointsFromTrack(points: GpxTrackPoint[]): TimedPoint[] {
  return points
    .filter((point): point is GpxTrackPoint & { timestampMs: number } => point.timestampMs !== null)
    .map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude,
      timestampMs: point.timestampMs
    }));
}

export function extractMovingSplitsFromRaceGpx(
  raceGpxXml: string,
  checkpoints: RaceCourseCheckpoint[]
): { raceStartAt: string; actualSplits: BacktestActualSplit[] } {
  const parsed = parseGpxActivityTrack(raceGpxXml);
  const timed = timedPointsFromTrack(parsed.points);
  if (timed.length < 2) {
    throw new GpxBacktestError(
      "race_missing_timestamps",
      "Race GPX must include timestamps on track points (at least two timed points). Export a timed activity GPX and try again."
    );
  }
  const actualSplits = extractMovingSplitsFromTimedPoints(timed, checkpoints);
  return {
    raceStartAt: new Date(timed[0]!.timestampMs).toISOString(),
    actualSplits
  };
}

export function extractHistoryFromTrainingGpx(
  gpxXml: string,
  options: { id: string; ingestedAt: string; label?: string }
): ActivityHistoryRef {
  const metrics = parseGpxActivityMetrics(gpxXml);
  if (metrics.elapsedSeconds === undefined) {
    throw new GpxBacktestError(
      "history_missing_elapsed",
      `Training GPX${options.label ? ` (${options.label})` : ""} has no usable timestamps, so elapsed time is unknown. Export a timed activity GPX.`
    );
  }
  const recordedAt = metrics.recordedAt ?? options.ingestedAt;
  const row: ActivityHistoryRef = {
    id: options.id,
    source: "gpx_upload",
    externalId: `gpx:${fingerprintGpxExternalId(gpxXml)}`,
    recordedAt,
    ingestedAt: options.ingestedAt,
    distanceMeters: metrics.distanceMeters,
    elapsedSeconds: metrics.elapsedSeconds
  };
  if (metrics.elevationGainMeters !== undefined) {
    row.elevationGainMeters = metrics.elevationGainMeters;
  }
  return row;
}

function courseCheckpoints(courseGpxXml: string): RaceCourseCheckpoint[] {
  const parsed = parseGpxTrack(courseGpxXml);
  const routeMetricPoints: CourseMetricPoint[] = parsed.points.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    elevationMeters: point.elevationMeters
  }));
  const { course } = buildRaceCourseFromGpx(parsed);
  return checkpointsWithProjectedDistances(course.checkpoints, routeMetricPoints);
}

export type GpxBacktestInputs = {
  name?: string;
  courseGpxXml: string;
  raceGpxXml: string;
  trainingGpxXmls: string[];
  ingestedAt?: string;
};

/** Course + race + optional training GPX → scenario for {@link runPacingBacktest}. */
export function buildBacktestScenarioFromGpx(input: GpxBacktestInputs): BacktestScenario {
  const ingestedAt = input.ingestedAt ?? new Date().toISOString();
  const checkpoints = courseCheckpoints(input.courseGpxXml);
  const { raceStartAt, actualSplits } = extractMovingSplitsFromRaceGpx(input.raceGpxXml, checkpoints);
  const history = input.trainingGpxXmls.map((xml, index) =>
    extractHistoryFromTrainingGpx(xml, {
      id: `hist-${index + 1}`,
      ingestedAt,
      label: `file ${index + 1}`
    })
  );
  return {
    name: input.name ?? "GPX backtest",
    raceStartAt,
    courseGpxXml: input.courseGpxXml,
    history,
    actualSplits
  };
}
