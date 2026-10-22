/**
 * Turn a real completed effort (course GPX + timed race GPX + pre-race training GPX) into a corpus
 * effort. Adapted from the extraction in #499 (interactive GPX backtest), made non-interactive and
 * stricter about checkpoint order.
 *
 * Moving splits: time is excluded as aid STOPPAGE only when BOTH (1) the athlete is within
 * {@link AID_NEAR_METERS} of a course checkpoint and (2) they are stopped or slower than ~30 min/mi.
 * Stops elsewhere count as moving (the model predicts moving time between aids, including the odd
 * shoe-tie). Checkpoints must be reached in course order, so an out-and-back aid, or an aid near
 * the start line, is scored on the correct pass.
 *
 * Only derived numbers are stored: split seconds and history summaries. The raw race and training
 * tracks never enter the corpus.
 */
import type { ActivityHistoryRef, RaceCourseCheckpoint } from "@crewcue/contracts";
import { parseGpxActivityTrack, type GpxTrackPoint } from "@crewcue/map-core";
import type { BacktestActualSplit } from "../backtest.js";
import { buildBacktestInputs } from "../backtest.js";
import { fingerprintGpxExternalId, parseGpxActivityMetrics } from "../../gpxActivityHistory.js";
import { EVALUATION_EFFORT_SCHEMA_VERSION, type EffortProvenance, type EvaluationEffort } from "./corpus.js";

/** Horizontal radius (meters) for "at an aid". */
export const AID_NEAR_METERS = 75;
const METERS_PER_MILE = 1609.344;
/** 30 min/mi in m/s. Slower than this (or no movement) near an aid is stoppage. */
export const STOPPAGE_MAX_SPEED_METERS_PER_SEC = METERS_PER_MILE / (30 * 60);
const FINISH_ID = "finish";
const EARTH_RADIUS_METERS = 6_371_000;

export type GpxImportErrorCode = "race_missing_timestamps" | "history_missing_elapsed" | "aid_not_visited";

export class GpxImportError extends Error {
  readonly code: GpxImportErrorCode;

  constructor(code: GpxImportErrorCode, message: string) {
    super(message);
    this.name = "GpxImportError";
    this.code = code;
  }
}

export type TimedPoint = { latitude: number; longitude: number; timestampMs: number };
type LatLon = { latitude: number; longitude: number };

export function haversineMeters(a: LatLon, b: LatLon): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function nearAny(point: LatLon, places: LatLon[]): boolean {
  return places.some((place) => haversineMeters(point, place) <= AID_NEAR_METERS);
}

/** True when a track step is near a checkpoint AND slow enough to be stoppage. */
export function isStoppageSegment(from: TimedPoint, to: TimedPoint, checkpoints: LatLon[]): boolean {
  const dtSeconds = (to.timestampMs - from.timestampMs) / 1000;
  if (!(dtSeconds > 0)) {
    return false;
  }
  const meters = haversineMeters(from, to);
  const slow = meters < 0.5 || meters / dtSeconds <= STOPPAGE_MAX_SPEED_METERS_PER_SEC;
  return slow && (nearAny(from, checkpoints) || nearAny(to, checkpoints));
}

/**
 * Moving elapsed at the first in-order arrival at each checkpoint past the start.
 * The finish is reported under the id `finish` (the corpus convention).
 */
export function extractMovingSplits(points: TimedPoint[], checkpoints: RaceCourseCheckpoint[]): BacktestActualSplit[] {
  const sorted = [...points].sort((a, b) => a.timestampMs - b.timestampMs);
  if (sorted.length < 2) {
    throw new GpxImportError(
      "race_missing_timestamps",
      "Race GPX must include timestamps on track points (at least two timed points). Export a timed activity GPX."
    );
  }
  const ordered = [...checkpoints].sort((a, b) => (a.distanceMetersFromStart ?? 0) - (b.distanceMetersFromStart ?? 0));
  const targets = ordered.filter((checkpoint) => (checkpoint.distanceMetersFromStart ?? 0) > 0);
  const stations: LatLon[] = ordered.map(({ latitude, longitude }) => ({ latitude, longitude }));
  const startMs = sorted[0]!.timestampMs;
  const splits: BacktestActualSplit[] = [];
  let nextTarget = 0;
  let stoppageSeconds = 0;

  for (let index = 0; index < sorted.length && nextTarget < targets.length; index += 1) {
    const point = sorted[index]!;
    if (index > 0 && isStoppageSegment(sorted[index - 1]!, point, stations)) {
      stoppageSeconds += (point.timestampMs - sorted[index - 1]!.timestampMs) / 1000;
    }
    const target = targets[nextTarget]!;
    if (haversineMeters(point, target) <= AID_NEAR_METERS) {
      const isLast = nextTarget === targets.length - 1;
      splits.push({
        checkpointId: isLast ? FINISH_ID : target.id,
        actualElapsedSeconds: Math.max(1, Math.round((point.timestampMs - startMs) / 1000 - stoppageSeconds))
      });
      nextTarget += 1;
    }
  }

  if (nextTarget < targets.length) {
    const missing = targets.slice(nextTarget).map((checkpoint) => checkpoint.title ?? checkpoint.id);
    throw new GpxImportError(
      "aid_not_visited",
      `Race track never came within ${AID_NEAR_METERS} m of (in course order): ${missing.join(", ")}. Check that the race GPX is the same course.`
    );
  }
  return splits;
}

function timedPoints(points: GpxTrackPoint[]): TimedPoint[] {
  return points
    .filter((point): point is GpxTrackPoint & { timestampMs: number } => point.timestampMs !== null)
    .map(({ latitude, longitude, timestampMs }) => ({ latitude, longitude, timestampMs }));
}

export function historyFromTrainingGpx(
  gpxXml: string,
  options: { id: string; ingestedAt: string; label: string }
): ActivityHistoryRef {
  const metrics = parseGpxActivityMetrics(gpxXml);
  if (metrics.elapsedSeconds === undefined || metrics.recordedAt === undefined) {
    throw new GpxImportError(
      "history_missing_elapsed",
      `Training GPX ${options.label} has no usable timestamps, so elapsed time is unknown. Export a timed activity GPX.`
    );
  }
  return {
    id: options.id,
    source: "gpx_upload",
    externalId: `gpx:${fingerprintGpxExternalId(gpxXml)}`,
    recordedAt: metrics.recordedAt,
    ingestedAt: options.ingestedAt,
    distanceMeters: metrics.distanceMeters,
    elapsedSeconds: metrics.elapsedSeconds,
    ...(metrics.elevationGainMeters !== undefined ? { elevationGainMeters: metrics.elevationGainMeters } : {})
  };
}

export type GpxEffortImport = {
  id: string;
  group: string;
  provenance: EffortProvenance;
  /** Course path relative to the corpus root (where the caller stores the course GPX). */
  coursePath: string;
  courseGpxXml: string;
  raceGpxXml: string;
  trainingGpxXmls: Array<{ label: string; xml: string }>;
  /** Extra summary rows (e.g. from a Strava export) recorded before the race. */
  historyRows?: ActivityHistoryRef[];
  tags?: string[];
};

export function buildEffortFromGpx(input: GpxEffortImport): EvaluationEffort {
  const race = timedPoints(parseGpxActivityTrack(input.raceGpxXml).points);
  if (race.length < 2) {
    throw new GpxImportError(
      "race_missing_timestamps",
      "Race GPX must include timestamps on track points (at least two timed points). Export a timed activity GPX."
    );
  }
  const raceStartAt = new Date(race[0]!.timestampMs).toISOString();
  const { checkpoints } = buildBacktestInputs({
    name: input.id,
    raceStartAt,
    courseGpxXml: input.courseGpxXml,
    history: [],
    actualSplits: []
  });
  const actualSplits = extractMovingSplits(race, checkpoints);
  const training = input.trainingGpxXmls.map((file, index) =>
    historyFromTrainingGpx(file.xml, {
      id: `${input.group}-hist-${String(index + 1).padStart(2, "0")}`,
      ingestedAt: raceStartAt,
      label: file.label
    })
  );
  return {
    schemaVersion: EVALUATION_EFFORT_SCHEMA_VERSION,
    id: input.id,
    group: input.group,
    provenance: input.provenance,
    course: input.coursePath,
    raceStartAt,
    history: [...training, ...(input.historyRows ?? [])],
    actualSplits,
    ...(input.tags ? { tags: input.tags } : {})
  };
}
