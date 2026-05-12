import type {
  RaceCourseBaselinePoint,
  RaceCourseBaselineTrack,
  RaceCourseCheckpoint,
  RaceCourseDerivedMetrics
} from "@crewcue/contracts";
import distance from "@turf/distance";
import length from "@turf/length";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import { lineString, point } from "@turf/helpers";

export const COURSE_METRICS_VERSION = 1;

const METERS_PER_KILOMETER = 1000;
const DEFAULT_MAX_BASELINE_POINTS = 220;
const MIN_REFERENCE_STEP_SECONDS = 0.1;

export type CourseMetricPoint = {
  latitude: number;
  longitude: number;
  elevationMeters?: number | null;
};

export type SmoothedElevationSample = {
  distanceMetersFromStart: number;
  elevationMeters: number;
};

export type ProjectedCoursePoint = {
  progressMeters: number;
  courseLengthMeters: number;
  distanceMetersFromRoute: number;
};

type BuildBaselineOptions = {
  maxPoints?: number;
  gainPenaltySecondsPerMeter?: number;
  descentCreditSecondsPerMeter?: number;
  maxDescentCreditRatio?: number;
};

function toLngLat(point: Pick<CourseMetricPoint, "latitude" | "longitude">): [number, number] {
  return [point.longitude, point.latitude];
}

function validPolyline(points: CourseMetricPoint[]): CourseMetricPoint[] {
  return points.filter(
    (p) =>
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude) &&
      p.latitude >= -90 &&
      p.latitude <= 90 &&
      p.longitude >= -180 &&
      p.longitude <= 180
  );
}

function downsampleBaselinePoints(points: RaceCourseBaselinePoint[], maxPoints: number): RaceCourseBaselinePoint[] {
  if (points.length <= maxPoints) {
    return points;
  }
  const sampled: RaceCourseBaselinePoint[] = [points[0]!];
  const interiorTarget = Math.max(0, maxPoints - 2);
  for (let i = 1; i <= interiorTarget; i += 1) {
    const index = Math.round((i * (points.length - 1)) / (interiorTarget + 1));
    sampled.push(points[index]!);
  }
  sampled.push(points[points.length - 1]!);
  return sampled;
}

export function geodesicDistanceMeters(
  a: Pick<CourseMetricPoint, "latitude" | "longitude">,
  b: Pick<CourseMetricPoint, "latitude" | "longitude">
): number {
  return distance(toLngLat(a), toLngLat(b), { units: "kilometers" }) * METERS_PER_KILOMETER;
}

export function geodesicPolylineLength(points: CourseMetricPoint[]): number {
  const canonical = validPolyline(points);
  if (canonical.length < 2) {
    return 0;
  }
  return length(lineString(canonical.map(toLngLat)), { units: "kilometers" }) * METERS_PER_KILOMETER;
}

export function geodesicCumulativeAtVertices(points: CourseMetricPoint[]): number[] {
  const canonical = validPolyline(points);
  if (canonical.length === 0) {
    return [];
  }
  const cumulative = [0];
  for (let index = 1; index < canonical.length; index += 1) {
    cumulative.push(cumulative[index - 1]! + geodesicDistanceMeters(canonical[index - 1]!, canonical[index]!));
  }
  return cumulative;
}

export function geodesicProjectPointToPolyline(
  points: CourseMetricPoint[],
  target: Pick<CourseMetricPoint, "latitude" | "longitude">
): ProjectedCoursePoint {
  const canonical = validPolyline(points);
  const courseLengthMeters = geodesicPolylineLength(canonical);
  if (canonical.length < 2) {
    return { progressMeters: 0, courseLengthMeters, distanceMetersFromRoute: 0 };
  }

  const projected = nearestPointOnLine(lineString(canonical.map(toLngLat)), point(toLngLat(target)), {
    units: "kilometers"
  }) as unknown as { properties?: { location?: number; dist?: number } };
  const progressMeters = Math.min(
    courseLengthMeters,
    Math.max(0, (projected.properties?.location ?? 0) * METERS_PER_KILOMETER)
  );
  const distanceMetersFromRoute = Math.max(0, (projected.properties?.dist ?? 0) * METERS_PER_KILOMETER);
  return { progressMeters, courseLengthMeters, distanceMetersFromRoute };
}

export function smoothElevations(
  points: CourseMetricPoint[],
  options: { windowSize?: number } = {}
): SmoothedElevationSample[] {
  const canonical = validPolyline(points);
  const raw = canonical.map((p) =>
    typeof p.elevationMeters === "number" && Number.isFinite(p.elevationMeters) ? p.elevationMeters : null
  );
  if (canonical.length < 2 || raw.filter((v): v is number => v !== null).length < 2) {
    return [];
  }

  const windowSize = Math.max(1, Math.floor(options.windowSize ?? 5));
  const radius = Math.floor(windowSize / 2);
  const cumulative = geodesicCumulativeAtVertices(canonical);

  return canonical.map((_, index) => {
    const values: number[] = [];
    for (let cursor = Math.max(0, index - radius); cursor <= Math.min(raw.length - 1, index + radius); cursor += 1) {
      const value = raw[cursor];
      if (value !== null) {
        values.push(value);
      }
    }
    const fallback =
      raw[index] ??
      raw.slice(0, index).reverse().find((value): value is number => value !== null) ??
      raw.slice(index + 1).find((value): value is number => value !== null) ??
      0;
    const elevationMeters = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
    return { distanceMetersFromStart: cumulative[index] ?? 0, elevationMeters };
  });
}

export function gainLossFromSmoothed(
  samples: SmoothedElevationSample[],
  options: { minimumDeltaMeters?: number } = {}
): { elevationGainMeters: number; elevationLossMeters: number } {
  const minimumDeltaMeters = Math.max(0, options.minimumDeltaMeters ?? 3);
  let gain = 0;
  let loss = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index]!.elevationMeters - samples[index - 1]!.elevationMeters;
    if (delta >= minimumDeltaMeters) {
      gain += delta;
    } else if (delta <= -minimumDeltaMeters) {
      loss += -delta;
    }
  }
  return { elevationGainMeters: gain, elevationLossMeters: loss };
}

export function buildPlanBaselineFromModel(
  points: CourseMetricPoint[],
  plannedPaceSecondsPerKm: number,
  options: BuildBaselineOptions = {}
): RaceCourseBaselineTrack | undefined {
  const canonical = validPolyline(points);
  if (canonical.length < 2 || !Number.isFinite(plannedPaceSecondsPerKm) || plannedPaceSecondsPerKm <= 0) {
    return undefined;
  }

  const cumulative = geodesicCumulativeAtVertices(canonical);
  const smoothed = smoothElevations(canonical);
  const elevationByIndex = new Map(smoothed.map((sample, index) => [index, sample.elevationMeters]));
  const gainPenaltySecondsPerMeter = options.gainPenaltySecondsPerMeter ?? 8;
  const descentCreditSecondsPerMeter = options.descentCreditSecondsPerMeter ?? 1.5;
  const maxDescentCreditRatio = Math.max(0, Math.min(0.8, options.maxDescentCreditRatio ?? 0.35));
  let elapsedSeconds = 0;

  const baseline: RaceCourseBaselinePoint[] = canonical.map((p, index) => {
    if (index > 0) {
      const segmentMeters = Math.max(0, (cumulative[index] ?? 0) - (cumulative[index - 1] ?? 0));
      const horizontalSeconds = (segmentMeters / METERS_PER_KILOMETER) * plannedPaceSecondsPerKm;
      const prevElevation = elevationByIndex.get(index - 1);
      const nextElevation = elevationByIndex.get(index);
      const elevationDelta =
        prevElevation !== undefined && nextElevation !== undefined ? nextElevation - prevElevation : 0;
      const gainSeconds = Math.max(0, elevationDelta) * gainPenaltySecondsPerMeter;
      const descentCredit = Math.min(
        horizontalSeconds * maxDescentCreditRatio,
        Math.max(0, -elevationDelta) * descentCreditSecondsPerMeter
      );
      elapsedSeconds += Math.max(MIN_REFERENCE_STEP_SECONDS, horizontalSeconds + gainSeconds - descentCredit);
    }

    const elevationMeters = elevationByIndex.get(index);
    return {
      distanceMetersFromStart: cumulative[index] ?? 0,
      referenceElapsedSeconds: elapsedSeconds,
      ...(elevationMeters !== undefined ? { elevationMeters } : {})
    };
  });

  return { points: downsampleBaselinePoints(baseline, options.maxPoints ?? DEFAULT_MAX_BASELINE_POINTS) };
}

export function buildDerivedMetricsFromPolyline(points: CourseMetricPoint[]): RaceCourseDerivedMetrics {
  const smoothed = smoothElevations(points);
  const vertical = smoothed.length >= 2 ? gainLossFromSmoothed(smoothed) : { elevationGainMeters: 0, elevationLossMeters: 0 };
  return {
    canonicalDistanceMeters: geodesicPolylineLength(points),
    elevationGainMeters: vertical.elevationGainMeters,
    elevationLossMeters: vertical.elevationLossMeters,
    elevationSource: smoothed.length >= 2 ? "gpx_smoothed" : "none",
    metricsVersion: COURSE_METRICS_VERSION
  };
}

export function checkpointsWithProjectedDistances(
  checkpoints: RaceCourseCheckpoint[],
  routePoints: CourseMetricPoint[]
): RaceCourseCheckpoint[] {
  return checkpoints.map((checkpoint) => ({
    ...checkpoint,
    distanceMetersFromStart: geodesicProjectPointToPolyline(routePoints, checkpoint).progressMeters
  }));
}
