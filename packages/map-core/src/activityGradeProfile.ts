/**
 * Per-run grade profile (slice 1 of docs/product/run-import-and-grade-curve-scope.md).
 *
 * Reduces a timed track to distance and moving time per 1% grade step, split by running and
 * hiking, so the personal climbing and descent model can be fitted (and refitted) without the
 * original file.
 *
 * 1. Quality: estimate the file's elevation noise and point spacing. Clean, dense tracks get a short
 *    smoothing window; noisy or sparse ones a long window.
 * 2. Resample the track every GRADE_PROFILE_STEP_METERS along its distance and smooth the
 *    elevation over that window. Grade is read from the smoothed profile, so a few decimeters of
 *    altitude wobble can't read as a steep pitch.
 * 3. Label each step running or hiking: from the watch's step cadence when the file has it,
 *    smoothed over a few seconds; else from speed and grade.
 * 4. Drop stopped time, then add each step's distance and time to its grade step.
 */
import {
  ACTIVITY_GRADE_PROFILE_MAX_PERCENT,
  ACTIVITY_GRADE_PROFILE_VERSION,
  type ActivityGradeProfile,
  type ActivityGradeProfileBin,
  type ActivityGradeProfileQuality
} from "@crewcue/contracts";
import type { GpxTrackPoint } from "./courseParse.js";

/** Resampling step along the track. Fine enough to keep run, hike and descent stretches apart. */
export const GRADE_PROFILE_STEP_METERS = 5;
/** Elevation smoothing window per file quality. Starting points; the backtest tunes them. */
export const GRADE_PROFILE_SMOOTHING_METERS: Record<ActivityGradeProfileQuality, number> = {
  high: 15,
  typical: 30,
  low: 40
};
/** High quality: elevation noise at or below this and points at most HIGH_MAX_SPACING apart. */
export const GRADE_PROFILE_HIGH_MAX_NOISE_METERS = 0.15;
export const GRADE_PROFILE_HIGH_MAX_SPACING_METERS = 5;
/** Low quality: elevation noise at or above this, or points at least LOW_MIN_SPACING apart. */
export const GRADE_PROFILE_LOW_MIN_NOISE_METERS = 0.6;
export const GRADE_PROFILE_LOW_MIN_SPACING_METERS = 15;
/** Slower than this over a step counts as stopped and is left out… */
export const GRADE_PROFILE_MOVING_MIN_SPEED_MPS = 0.5;
/** …unless it's climbing at least this fast (360 m/h): a slow hike up a 40% wall is still moving. */
export const GRADE_PROFILE_MOVING_MIN_CLIMB_RATE_MPS = 0.1;
/** Steps per minute (both feet) at or above which a moment counts as running. */
export const GRADE_PROFILE_RUN_MIN_STEPS_PER_MINUTE = 140;
/** Cadence is smoothed with a rolling median over this many seconds, so one slow step can't flip a label. */
export const GRADE_PROFILE_CADENCE_WINDOW_SECONDS = 10;
/** Use cadence labels when at least this share of points carry cadence. */
export const GRADE_PROFILE_CADENCE_MIN_COVERAGE = 0.5;
/**
 * Files record strides per minute (one foot). When the 90th percentile is above this, the file
 * must already count both feet (one foot tops out near 110 even when sprinting), so it isn't
 * doubled. A percentile, not the median, so a mostly-hiking run still shows its running cadence.
 * A run that is all hiking and recorded in total steps would still be doubled; FIT, TCX and
 * Garmin GPX all record strides, so that needs an unusual exporter.
 */
export const GRADE_PROFILE_STRIDES_MAX_P90 = 130;
/** Speed rule when there's no cadence: on climbs steeper than CLIMB_GRADE, slower than CLIMB_SPEED is hiking. */
export const GRADE_PROFILE_FALLBACK_CLIMB_GRADE = 0.04;
export const GRADE_PROFILE_FALLBACK_CLIMB_HIKE_MAX_MPS = 1.5;
/** Elsewhere, slower than this is hiking. */
export const GRADE_PROFILE_FALLBACK_HIKE_MAX_MPS = 1.2;
/** Too little track to say anything. */
export const GRADE_PROFILE_MIN_POINTS = 10;
export const GRADE_PROFILE_MIN_METERS = 200;
/** Points farther apart than this (median) can't show grade detail; such files get no profile. */
export const GRADE_PROFILE_MAX_SPACING_METERS = 50;

type TrackSample = {
  meters: number;
  elevation: number;
  timeMs: number;
  cadence: number | null;
};

const EARTH_RADIUS_METERS = 6_371_008.8;

function haversineMeters(a: GpxTrackPoint, b: GpxTrackPoint): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Point-to-point elevation noise: a robust σ from second differences (MAD × 1.4826 / √6). Smooth
 * terrain has second differences near zero, so what's left is mostly measurement noise.
 */
export function estimateElevationNoiseMeters(elevations: readonly number[]): number {
  if (elevations.length < 3) return 0;
  const second: number[] = [];
  for (let index = 1; index < elevations.length - 1; index += 1) {
    second.push(elevations[index + 1]! - 2 * elevations[index]! + elevations[index - 1]!);
  }
  const center = median(second);
  const mad = median(second.map((value) => Math.abs(value - center)));
  return (mad * 1.4826) / Math.sqrt(6);
}

export function gradeProfileQuality(
  elevationNoiseMeters: number,
  medianPointSpacingMeters: number
): ActivityGradeProfileQuality {
  if (
    elevationNoiseMeters <= GRADE_PROFILE_HIGH_MAX_NOISE_METERS &&
    medianPointSpacingMeters <= GRADE_PROFILE_HIGH_MAX_SPACING_METERS
  ) {
    return "high";
  }
  if (
    elevationNoiseMeters >= GRADE_PROFILE_LOW_MIN_NOISE_METERS ||
    medianPointSpacingMeters >= GRADE_PROFILE_LOW_MIN_SPACING_METERS
  ) {
    return "low";
  }
  return "typical";
}

/** Timed, positioned points with elevation, in time order, with distance along the track. */
function toSamples(points: readonly GpxTrackPoint[]): TrackSample[] {
  const samples: TrackSample[] = [];
  let previous: GpxTrackPoint | null = null;
  let meters = 0;
  for (const point of points) {
    if (
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      point.timestampMs === null ||
      point.elevationMeters === null ||
      !Number.isFinite(point.elevationMeters)
    ) {
      continue;
    }
    if (previous && previous.timestampMs !== null && point.timestampMs < previous.timestampMs) {
      continue;
    }
    if (previous) meters += haversineMeters(previous, point);
    const cadence = typeof point.cadence === "number" && point.cadence > 0 ? point.cadence : null;
    samples.push({ meters, elevation: point.elevationMeters, timeMs: point.timestampMs, cadence });
    previous = point;
  }
  return samples;
}

/** Cadence in steps per minute (both feet), rolling-median smoothed; null where none is near. */
function smoothedStepsPerMinute(samples: readonly TrackSample[]): Array<number | null> {
  const raw = samples.map((sample) => sample.cadence).filter((value): value is number => value !== null);
  const sorted = [...raw].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0;
  const factor = p90 > GRADE_PROFILE_STRIDES_MAX_P90 ? 1 : 2;
  const halfWindowMs = (GRADE_PROFILE_CADENCE_WINDOW_SECONDS / 2) * 1000;
  const out: Array<number | null> = [];
  let lo = 0;
  let hi = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const t = samples[index]!.timeMs;
    while (samples[lo]!.timeMs < t - halfWindowMs) lo += 1;
    while (hi + 1 < samples.length && samples[hi + 1]!.timeMs <= t + halfWindowMs) hi += 1;
    const window: number[] = [];
    for (let j = lo; j <= hi; j += 1) {
      const cadence = samples[j]!.cadence;
      if (cadence !== null) window.push(cadence * factor);
    }
    out.push(window.length > 0 ? median(window) : null);
  }
  return out;
}

/**
 * Build the grade profile for one activity, or null when the track has no clock times, no
 * elevation, too little distance, or points too far apart.
 */
export function buildActivityGradeProfile(points: readonly GpxTrackPoint[]): ActivityGradeProfile | null {
  const samples = toSamples(points);
  if (samples.length < GRADE_PROFILE_MIN_POINTS) return null;
  const totalMeters = samples[samples.length - 1]!.meters;
  if (totalMeters < GRADE_PROFILE_MIN_METERS) return null;

  const spacings: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index]!.meters - samples[index - 1]!.meters;
    if (delta > 0) spacings.push(delta);
  }
  const medianPointSpacingMeters = median(spacings);
  if (medianPointSpacingMeters > GRADE_PROFILE_MAX_SPACING_METERS) return null;
  const elevationNoiseMeters = estimateElevationNoiseMeters(samples.map((sample) => sample.elevation));
  const quality = gradeProfileQuality(elevationNoiseMeters, medianPointSpacingMeters);
  const smoothingMeters = GRADE_PROFILE_SMOOTHING_METERS[quality];

  const cadenceCoverage = samples.filter((sample) => sample.cadence !== null).length / samples.length;
  const labelSource = cadenceCoverage >= GRADE_PROFILE_CADENCE_MIN_COVERAGE ? "cadence" : "speed";
  const stepsPerMinute = labelSource === "cadence" ? smoothedStepsPerMinute(samples) : null;

  // Resample every STEP meters: elevation, time, and the sample the step starts in.
  const step = GRADE_PROFILE_STEP_METERS;
  const gridElevation: number[] = [];
  const gridTimeMs: number[] = [];
  const gridSample: number[] = [];
  let segment = 0;
  for (let meters = 0; meters <= totalMeters; meters += step) {
    while (segment + 1 < samples.length - 1 && samples[segment + 1]!.meters <= meters) segment += 1;
    // Skip zero-length segments (stationary points) so time keeps the latest arrival.
    while (segment + 1 < samples.length - 1 && samples[segment + 1]!.meters === samples[segment]!.meters) segment += 1;
    const a = samples[segment]!;
    const b = samples[segment + 1] ?? a;
    const span = b.meters - a.meters;
    const t = span > 0 ? Math.min(1, Math.max(0, (meters - a.meters) / span)) : 0;
    gridElevation.push(a.elevation + (b.elevation - a.elevation) * t);
    gridTimeMs.push(a.timeMs + (b.timeMs - a.timeMs) * t);
    gridSample.push(t < 0.5 ? segment : Math.min(segment + 1, samples.length - 1));
  }

  // Centered moving average over the smoothing window (prefix sums).
  const half = Math.max(1, Math.round(smoothingMeters / 2 / step));
  const prefix = [0];
  for (const elevation of gridElevation) prefix.push(prefix[prefix.length - 1]! + elevation);
  const smoothed = gridElevation.map((_, index) => {
    const from = Math.max(0, index - half);
    const to = Math.min(gridElevation.length - 1, index + half);
    return (prefix[to + 1]! - prefix[from]!) / (to - from + 1);
  });

  const max = ACTIVITY_GRADE_PROFILE_MAX_PERCENT;
  const bins = new Map<number, ActivityGradeProfileBin>();
  let movingMeters = 0;
  let movingSeconds = 0;
  for (let index = 0; index + 1 < smoothed.length; index += 1) {
    const seconds = (gridTimeMs[index + 1]! - gridTimeMs[index]!) / 1000;
    if (!(seconds > 0)) continue;
    const rise = smoothed[index + 1]! - smoothed[index]!;
    const grade = rise / step;
    const moving =
      step / seconds >= GRADE_PROFILE_MOVING_MIN_SPEED_MPS || rise / seconds >= GRADE_PROFILE_MOVING_MIN_CLIMB_RATE_MPS;
    if (!moving) continue;
    const gradePercent = Math.max(-max, Math.min(max, Math.round(grade * 100)));

    const cadence = stepsPerMinute?.[gridSample[index]!] ?? null;
    let hiking: boolean;
    if (cadence !== null) {
      hiking = cadence < GRADE_PROFILE_RUN_MIN_STEPS_PER_MINUTE;
    } else {
      const speed = step / seconds;
      hiking =
        grade > GRADE_PROFILE_FALLBACK_CLIMB_GRADE
          ? speed < GRADE_PROFILE_FALLBACK_CLIMB_HIKE_MAX_MPS
          : speed < GRADE_PROFILE_FALLBACK_HIKE_MAX_MPS;
    }

    let bin = bins.get(gradePercent);
    if (!bin) {
      bin = { gradePercent, runMeters: 0, runSeconds: 0, hikeMeters: 0, hikeSeconds: 0 };
      bins.set(gradePercent, bin);
    }
    if (hiking) {
      bin.hikeMeters += step;
      bin.hikeSeconds += seconds;
    } else {
      bin.runMeters += step;
      bin.runSeconds += seconds;
    }
    movingMeters += step;
    movingSeconds += seconds;
  }
  if (movingMeters === 0) return null;

  const round1 = (value: number) => Math.round(value * 10) / 10;
  return {
    version: ACTIVITY_GRADE_PROFILE_VERSION,
    quality,
    smoothingMeters,
    elevationNoiseMeters: Math.round(elevationNoiseMeters * 1000) / 1000,
    medianPointSpacingMeters: round1(medianPointSpacingMeters),
    labelSource,
    movingMeters: Math.round(movingMeters),
    movingSeconds: Math.round(movingSeconds),
    bins: [...bins.values()]
      .sort((a, b) => a.gradePercent - b.gradePercent)
      .map((bin) => ({
        gradePercent: bin.gradePercent,
        runMeters: Math.round(bin.runMeters),
        runSeconds: round1(bin.runSeconds),
        hikeMeters: Math.round(bin.hikeMeters),
        hikeSeconds: round1(bin.hikeSeconds)
      }))
  };
}
