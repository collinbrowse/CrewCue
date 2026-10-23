/**
 * Course micro-segmentation for the physiology estimator.
 */
import {
  geodesicCumulativeAtVertices,
  geodesicDistanceMeters,
  type CourseMetricPoint
} from "@crewcue/map-core";
import { MICRO_SEGMENT_TARGET_METERS, SURFACE_COMPLEXITY } from "./constants.js";

export type CourseMicroSegment = {
  index: number;
  /** Distance along course at segment start (m). */
  startMeters: number;
  /** Segment length along course (m). */
  deltaXMeters: number;
  /** Elevation change over segment (m); 0 when elev unknown. */
  deltaZMeters: number;
  /** Grade g = Δz / Δx (0 when Δx ~ 0 or elev missing). */
  grade: number;
  /** Representative altitude (m); midpoint of endpoints when known, else 0. */
  altitudeMeters: number;
  /** Surface complexity (always 1 this epic). */
  surfaceComplexity: number;
};

function elevationAt(point: CourseMetricPoint): number | null {
  return typeof point.elevationMeters === "number" && Number.isFinite(point.elevationMeters)
    ? point.elevationMeters
    : null;
}

/**
 * Densify a polyline into ~MICRO_SEGMENT_TARGET_METERS chunks (last chunk may be shorter).
 * Uses geodesic vertex distances; interpolates elevation linearly when both ends have elev.
 */
export function buildCourseMicroSegments(routePoints: CourseMetricPoint[]): CourseMicroSegment[] {
  if (!Array.isArray(routePoints) || routePoints.length < 2) {
    return [];
  }

  const cumulative = geodesicCumulativeAtVertices(routePoints);
  const courseLen = cumulative[cumulative.length - 1] ?? 0;
  if (!(courseLen > 0)) {
    return [];
  }

  const samples: Array<{ meters: number; elevationMeters: number | null }> = [];
  samples.push({ meters: 0, elevationMeters: elevationAt(routePoints[0]!) });

  let nextTarget = MICRO_SEGMENT_TARGET_METERS;
  for (let i = 1; i < routePoints.length; i++) {
    const prevCum = cumulative[i - 1]!;
    const cum = cumulative[i]!;
    const prev = routePoints[i - 1]!;
    const curr = routePoints[i]!;
    const span = cum - prevCum;
    const elevA = elevationAt(prev);
    const elevB = elevationAt(curr);

    while (nextTarget < cum - 1e-6 && nextTarget <= courseLen + 1e-6) {
      const t = span > 0 ? (nextTarget - prevCum) / span : 0;
      let elev: number | null = null;
      if (elevA !== null && elevB !== null) {
        elev = elevA + t * (elevB - elevA);
      }
      samples.push({ meters: nextTarget, elevationMeters: elev });
      nextTarget += MICRO_SEGMENT_TARGET_METERS;
    }

    if (i === routePoints.length - 1) {
      samples.push({ meters: cum, elevationMeters: elevB });
    }
  }

  // Dedupe nearly identical distances
  const deduped: typeof samples = [];
  for (const sample of samples) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.meters - sample.meters) < 0.05) {
      deduped[deduped.length - 1] = sample;
    } else {
      deduped.push(sample);
    }
  }

  const segments: CourseMicroSegment[] = [];
  for (let i = 1; i < deduped.length; i++) {
    const a = deduped[i - 1]!;
    const b = deduped[i]!;
    const deltaX = Math.max(0, b.meters - a.meters);
    if (deltaX <= 0) {
      continue;
    }
    const hasElev = a.elevationMeters !== null && b.elevationMeters !== null;
    const deltaZ = hasElev ? (b.elevationMeters as number) - (a.elevationMeters as number) : 0;
    const grade = hasElev ? deltaZ / deltaX : 0;
    const altitudeMeters = hasElev
      ? ((a.elevationMeters as number) + (b.elevationMeters as number)) / 2
      : 0;
    segments.push({
      index: segments.length,
      startMeters: a.meters,
      deltaXMeters: deltaX,
      deltaZMeters: deltaZ,
      grade,
      altitudeMeters,
      surfaceComplexity: SURFACE_COMPLEXITY
    });
  }

  return segments;
}

/** Chord length fallback when only checkpoints exist (tests); prefer route mesh in production. */
export function buildMicroSegmentsFromCheckpoints(
  points: Array<{ latitude: number; longitude: number; elevationMeters?: number | null; distanceMetersFromStart?: number }>
): CourseMicroSegment[] {
  const metric: CourseMetricPoint[] = points.map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
    elevationMeters: p.elevationMeters
  }));
  if (metric.length >= 2 && geodesicDistanceMeters(metric[0]!, metric[1]!) > 0) {
    return buildCourseMicroSegments(metric);
  }
  return [];
}
