import type { NavigationRouteResult } from "@crewcue/contracts";

const EARTH_RADIUS_M = 6_371_000;

export type LonLat = { longitude: number; latitude: number };

/** Tunable thresholds for field experimentation */
export const ROUTE_PROGRESS_DEFAULTS = {
  lateralMaxMeters: 48,
  minAccuracyMeters: 120
};

function toRadians(d: number): number {
  return (d * Math.PI) / 180;
}

export function crowDistanceMeters(a: LonLat, b: LonLat): number {
  const φ1 = toRadians(a.latitude);
  const φ2 = toRadians(b.latitude);
  const Δφ = toRadians(b.latitude - a.latitude);
  const Δλ = toRadians(b.longitude - a.longitude);
  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);
  const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Project device position onto route geometry (lng/lat vertices).
 * Returns lateral distance to polyline and approximate distance-along-route from the start vertex.
 */
export function nearestPointOnPolyline(polyline: [number, number][], point: LonLat): { lateralMeters: number; alongMeters: number } {
  if (polyline.length < 2) {
    return { lateralMeters: Number.POSITIVE_INFINITY, alongMeters: 0 };
  }

  let cumulativeAlong = 0;
  let bestLateral = Number.POSITIVE_INFINITY;
  let bestAlong = 0;

  for (let i = 0; i < polyline.length - 1; i += 1) {
    const [lngA, latA] = polyline[i]!;
    const [lngB, latB] = polyline[i + 1]!;
    const cosLat = Math.cos(toRadians(latA));
    const ax = 0;
    const ay = 0;
    const bx = (lngB - lngA) * cosLat * (Math.PI / 180) * EARTH_RADIUS_M;
    const by = (latB - latA) * (Math.PI / 180) * EARTH_RADIUS_M;
    const px = (point.longitude - lngA) * cosLat * (Math.PI / 180) * EARTH_RADIUS_M;
    const py = (point.latitude - latA) * (Math.PI / 180) * EARTH_RADIUS_M;

    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const vv = vx * vx + vy * vy;
    const t = vv === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / vv));
    const cx = ax + t * vx;
    const cy = ay + t * vy;
    const lateral = Math.hypot(px - cx, py - cy);

    const segLen = crowDistanceMeters({ longitude: lngA, latitude: latA }, { longitude: lngB, latitude: latB });
    const alongSegment = t * segLen;
    const totalAlong = cumulativeAlong + alongSegment;

    if (lateral < bestLateral) {
      bestLateral = lateral;
      bestAlong = totalAlong;
    }

    cumulativeAlong += segLen;
  }

  return { lateralMeters: bestLateral, alongMeters: bestAlong };
}

/**
 * Determine active maneuver step index from projected distance along route.
 * Returns null when lateral distance exceeds threshold (off-route → freeze advancement).
 */
export function navigationActiveStepIndex(
  route: NavigationRouteResult,
  alongMeters: number,
  lateralMeters: number,
  opts: Pick<typeof ROUTE_PROGRESS_DEFAULTS, "lateralMaxMeters"> = ROUTE_PROGRESS_DEFAULTS
): number | null {
  if (!route.steps.length) {
    return 0;
  }
  if (lateralMeters > opts.lateralMaxMeters) {
    return null;
  }

  let accBefore = 0;
  for (let i = 0; i < route.steps.length; i += 1) {
    const stepLen = route.steps[i]!.distanceMeters;
    const accAfter = accBefore + stepLen;
    if (alongMeters < accAfter) {
      return i;
    }
    accBefore = accAfter;
  }
  return route.steps.length - 1;
}
