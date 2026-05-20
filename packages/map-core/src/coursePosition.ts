import type { MapWorkspaceLayer, RaceCourse, RaceCourseCheckpoint, RaceMapWorkspace } from "@crewcue/contracts";
import { PRIMARY_COURSE_ROUTE_LAYER_ID } from "./mapWorkspace.js";

const EARTH_RADIUS_M = 6371000;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Haversine distance between two WGS84 points (meters). */
export function haversineDistanceBetweenPoints(
  a: Pick<RaceCourseCheckpoint, "latitude" | "longitude">,
  b: Pick<RaceCourseCheckpoint, "latitude" | "longitude">
): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return EARTH_RADIUS_M * c;
}

function haversineLngLat(a: [number, number], b: [number, number]): number {
  return haversineDistanceBetweenPoints(
    { latitude: a[1], longitude: a[0] },
    { latitude: b[1], longitude: b[0] }
  );
}

/** Cumulative planar distance along checkpoint centers (matches WS2 polyline projection driver). */
export function cumulativeDistancesAlongCheckpoints(checkpoints: RaceCourseCheckpoint[]): number[] {
  const out: number[] = [];
  let cum = 0;
  for (let i = 0; i < checkpoints.length; i += 1) {
    out.push(cum);
    if (i < checkpoints.length - 1) {
      cum += haversineDistanceBetweenPoints(checkpoints[i]!, checkpoints[i + 1]!);
    }
  }
  return out;
}

/**
 * Interpolate latitude/longitude at `distanceMetersFromStart` along the race checkpoint polyline.
 * Clamps to start/end when distance is out of range.
 */
export function latLngAtDistanceAlongCheckpointCourse(
  course: RaceCourse | undefined,
  distanceMetersFromStart: number
): { latitude: number; longitude: number } | null {
  const checkpoints = course?.checkpoints ?? [];
  if (checkpoints.length === 0) {
    return null;
  }
  if (checkpoints.length === 1) {
    const c = checkpoints[0]!;
    return { latitude: c.latitude, longitude: c.longitude };
  }

  const cum = cumulativeDistancesAlongCheckpoints(checkpoints);
  const total = cum[cum.length - 1] ?? 0;
  const d = Math.max(0, Math.min(distanceMetersFromStart, total));

  for (let i = 0; i < checkpoints.length - 1; i += 1) {
    const startM = cum[i]!;
    const endM = cum[i + 1]!;
    if (d >= startM && d <= endM) {
      const segLen = endM - startM;
      const t = segLen > 1e-6 ? (d - startM) / segLen : 0;
      const A = checkpoints[i]!;
      const B = checkpoints[i + 1]!;
      return {
        latitude: A.latitude + t * (B.latitude - A.latitude),
        longitude: A.longitude + t * (B.longitude - A.longitude)
      };
    }
  }

  const last = checkpoints[checkpoints.length - 1]!;
  return { latitude: last.latitude, longitude: last.longitude };
}

/**
 * Interpolate [lng, lat] at distance along a dense polyline (GeoJSON order).
 */
export function lngLatAtDistanceAlongPolyline(polyline: [number, number][], distanceMetersFromStart: number): [number, number] | null {
  if (polyline.length === 0) {
    return null;
  }
  if (polyline.length === 1) {
    return polyline[0]!;
  }

  const cum: number[] = [0];
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const len = haversineLngLat(polyline[i]!, polyline[i + 1]!);
    cum.push((cum[cum.length - 1] ?? 0) + len);
  }

  const total = cum[cum.length - 1] ?? 0;
  const d = Math.max(0, Math.min(distanceMetersFromStart, total));

  for (let i = 0; i < polyline.length - 1; i += 1) {
    const startM = cum[i]!;
    const endM = cum[i + 1]!;
    if (d >= startM && d <= endM) {
      const segLen = endM - startM;
      const t = segLen > 1e-6 ? (d - startM) / segLen : 0;
      const A = polyline[i]!;
      const B = polyline[i + 1]!;
      return [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])];
    }
  }

  return polyline[polyline.length - 1]!;
}

function layerLngLatPolyline(layer: MapWorkspaceLayer | undefined): [number, number][] {
  const g = layer?.geometry;
  if (!g) {
    return [];
  }
  if (g.type === "LineString" && g.coordinates.length >= 2) {
    return g.coordinates.map((c) => [c[0], c[1]] as [number, number]);
  }
  if (g.type === "MultiLineString") {
    for (const ring of g.coordinates) {
      if (ring.length >= 2) {
        return ring.map((c) => [c[0], c[1]] as [number, number]);
      }
    }
  }
  return [];
}

/** Prefer the projection-driving workspace route; otherwise visible layers, then checkpoint centers. */
export function primaryCourseLngLatPolyline(course: RaceCourse | undefined, workspace: RaceMapWorkspace | undefined): [number, number][] {
  const layers = workspace?.layers ?? [];
  const drivingLayer = workspace?.drivesProjectionLayerId
    ? layers.find((l) => l.id === workspace.drivesProjectionLayerId)
    : layers.find((l) => l.id === PRIMARY_COURSE_ROUTE_LAYER_ID);
  const drivingLine = layerLngLatPolyline(drivingLayer);
  if (drivingLine.length >= 2) {
    return drivingLine;
  }

  const visible = layers.filter((l) => l.visible);
  for (const layer of visible) {
    const line = layerLngLatPolyline(layer);
    if (line.length >= 2) {
      return line;
    }
  }

  const cps = course?.checkpoints ?? [];
  if (cps.length >= 2) {
    return cps.map((cp) => [cp.longitude, cp.latitude] as [number, number]);
  }
  return [];
}

export type ElevationSample = { distanceMetersFromStart: number; elevationMeters: number };

/**
 * From a monotonic distance profile, compute positive (gain) and negative (loss) vertical
 * remaining strictly after `distanceMetersFromStart` along the sampled path.
 */
export function remainingGainAndLossMetersAfter(
  samples: ElevationSample[],
  distanceMetersFromStart: number
): { gainRemainingMeters: number; lossRemainingMeters: number } | null {
  if (samples.length < 2) {
    return null;
  }

  let gain = 0;
  let loss = 0;
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    const segStart = a.distanceMetersFromStart;
    const segEnd = b.distanceMetersFromStart;
    if (segEnd <= distanceMetersFromStart) {
      continue;
    }

    const delta = b.elevationMeters - a.elevationMeters;
    const segLen = segEnd - segStart;
    if (segLen <= 0) {
      continue;
    }

    let effDelta = delta;
    if (segStart < distanceMetersFromStart && distanceMetersFromStart < segEnd) {
      const t = (distanceMetersFromStart - segStart) / segLen;
      const elevAt = a.elevationMeters + t * delta;
      effDelta = b.elevationMeters - elevAt;
    }

    if (effDelta > 0) {
      gain += effDelta;
    } else if (effDelta < 0) {
      loss += -effDelta;
    }
  }

  return { gainRemainingMeters: gain, lossRemainingMeters: loss };
}

/**
 * Build elevation samples from workspace GeoJSON when coordinates include a third elevation element.
 */
export function elevationSamplesFromWorkspacePolyline(workspace: RaceMapWorkspace | undefined): ElevationSample[] | null {
  const poly = primaryCourseLngLatPolyline(undefined, workspace);
  if (poly.length < 2 || !workspace?.layers?.length) {
    return null;
  }

  const visible = workspace.layers.filter((l) => l.visible);
  let coordSource: [number, number, number?][] | undefined;
  for (const layer of visible) {
    const g = layer.geometry;
    if (g.type === "LineString" && g.coordinates.length >= 2) {
      coordSource = g.coordinates as [number, number, number?][];
      break;
    }
    if (g.type === "MultiLineString") {
      for (const ring of g.coordinates) {
        if (ring.length >= 2) {
          coordSource = ring as [number, number, number?][];
          break;
        }
      }
    }
    if (coordSource) {
      break;
    }
  }

  if (!coordSource || coordSource.length < 2) {
    return null;
  }

  const hasZ = coordSource.some((c) => c.length > 2 && typeof c[2] === "number" && Number.isFinite(c[2]!));
  if (!hasZ) {
    return null;
  }

  const samples: ElevationSample[] = [];
  let cum = 0;
  samples.push({ distanceMetersFromStart: 0, elevationMeters: coordSource[0]![2] ?? 0 });
  for (let i = 1; i < coordSource.length; i += 1) {
    const prev = coordSource[i - 1]!;
    const cur = coordSource[i]!;
    const a: [number, number] = [prev[0], prev[1]];
    const b: [number, number] = [cur[0], cur[1]];
    cum += haversineLngLat(a, b);
    const e = typeof cur[2] === "number" && Number.isFinite(cur[2]) ? cur[2] : samples[samples.length - 1]!.elevationMeters;
    samples.push({ distanceMetersFromStart: cum, elevationMeters: e });
  }
  return samples;
}
