import type { RaceCourse } from "@crewcue/contracts";

export type GpxTrackPoint = {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  timestampMs: number | null;
};

export type ParsedGpxTrack = {
  points: GpxTrackPoint[];
  waypoints: GpxWaypoint[];
  totalDistanceMeters: number;
  startTimestampMs: number;
  endTimestampMs: number;
  totalDurationSeconds: number;
  averagePaceSecondsPerKm: number;
};

export type ExpectedSplit = {
  splitIndex: number;
  distanceKm: number;
  distanceLabel: string;
  elapsedSeconds: number;
  elapsedLabel: string;
};

export type DistanceUnit = "km" | "mi";

const METERS_PER_KILOMETER = 1000;
const METERS_PER_MILE = 1609.344;
const DEFAULT_PACE_SECONDS_PER_KM = 360;
const MAX_BASELINE_POINTS = 220;

export function parseCourseTrack(fileContents: string, fileName: string): ParsedGpxTrack {
  const normalizedName = fileName.trim().toLowerCase();

  if (normalizedName.endsWith(".gpx") || /<gpx[\s>]/i.test(fileContents)) {
    return parseGpxTrack(fileContents);
  }

  if (normalizedName.endsWith(".kml") || /<kml[\s>]/i.test(fileContents)) {
    return parseKmlTrack(fileContents);
  }

  if (
    normalizedName.endsWith(".json") ||
    normalizedName.endsWith(".geojson") ||
    fileContents.trim().startsWith("{") ||
    fileContents.trim().startsWith("[")
  ) {
    return parseJsonTrack(fileContents);
  }

  throw new Error("Unsupported course file type. Upload GPX, KML, or JSON route data.");
}

export function parseGpxTrack(gpxXml: string): ParsedGpxTrack {
  const normalizedXml = gpxXml.replace(/^\uFEFF/, "");
  if (!normalizedXml.trim()) {
    throw new Error("GPX file is empty. Export a valid GPX track and try again.");
  }

  const points = extractTrackPoints(normalizedXml);
  const waypoints = extractWaypointsFromXml(normalizedXml);
  if (points.length < 2) {
    throw new Error("GPX must include at least two track points.");
  }

  const totalDistanceMeters = calculateTotalDistance(points);
  if (totalDistanceMeters <= 0) {
    throw new Error("GPX track distance is zero. Use a GPX with movement data.");
  }
  const timing = deriveTimingFromPoints(points, totalDistanceMeters);

  return {
    points,
    waypoints,
    totalDistanceMeters,
    startTimestampMs: timing.startTimestampMs,
    endTimestampMs: timing.endTimestampMs,
    totalDurationSeconds: timing.totalDurationSeconds,
    averagePaceSecondsPerKm: timing.totalDurationSeconds / (totalDistanceMeters / METERS_PER_KILOMETER)
  };
}

function parseKmlTrack(kml: string): ParsedGpxTrack {
  const normalized = kml.replace(/^\uFEFF/, "");
  if (!normalized.trim()) {
    throw new Error("KML file is empty. Export a valid route and try again.");
  }

  const points = extractKmlTrackPoints(normalized);
  if (points.length < 2) {
    throw new Error("KML must include at least two route coordinates.");
  }

  return buildParsedTrackFromPoints(points, extractKmlWaypoints(normalized));
}

function parseJsonTrack(jsonText: string): ParsedGpxTrack {
  const normalized = jsonText.replace(/^\uFEFF/, "");
  if (!normalized.trim()) {
    throw new Error("JSON file is empty. Export a valid route and try again.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(normalized);
  } catch {
    throw new Error("JSON route file is invalid. Export valid JSON and try again.");
  }

  const points = extractJsonTrackPoints(parsedJson);
  if (points.length < 2) {
    throw new Error("JSON route must include at least two coordinates.");
  }

  return buildParsedTrackFromPoints(points, []);
}

export function buildExpectedSplits(
  parsedTrack: ParsedGpxTrack,
  unit: DistanceUnit = "km"
): ExpectedSplit[] {
  const unitMeters = unit === "km" ? METERS_PER_KILOMETER : METERS_PER_MILE;
  const totalUnits = parsedTrack.totalDistanceMeters / unitMeters;
  const splitCount = Math.floor(totalUnits);

  if (splitCount < 1) {
    return [];
  }

  const averageSecondsPerUnit = parsedTrack.totalDurationSeconds / totalUnits;

  return Array.from({ length: splitCount }, (_, index) => {
    const splitIndex = index + 1;
    const elapsedSeconds = averageSecondsPerUnit * splitIndex;
    return {
      splitIndex,
      distanceKm: (splitIndex * unitMeters) / METERS_PER_KILOMETER,
      distanceLabel: unit === "km" ? `${splitIndex} km` : `${splitIndex} mi`,
      elapsedSeconds,
      elapsedLabel: formatDuration(elapsedSeconds)
    };
  });
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatPace(secondsPerKm: number, unit: DistanceUnit = "km"): string {
  const secondsPerUnit = unit === "km" ? secondsPerKm : secondsPerKm * (METERS_PER_MILE / METERS_PER_KILOMETER);
  return `${formatDuration(secondsPerUnit)}/${unit}`;
}

export function formatDistance(distanceMeters: number, unit: DistanceUnit = "km"): string {
  const distance = unit === "km" ? distanceMeters / METERS_PER_KILOMETER : distanceMeters / METERS_PER_MILE;
  return `${distance.toFixed(2)} ${unit}`;
}

export function buildRaceCourseFromGpx(parsedTrack: ParsedGpxTrack): {
  course: RaceCourse;
  plannedPaceSecondsPerKm: number;
} {
  const checkpoints =
    parsedTrack.waypoints.length >= 2
      ? parsedTrack.waypoints.map((waypoint, index) => ({
          id: sanitizeCheckpointId(waypoint.name, index + 1),
          latitude: waypoint.latitude,
          longitude: waypoint.longitude,
          plannedStopSeconds: 120
        }))
      : buildFallbackCheckpoints(parsedTrack.points);

  const baselinePoints = buildBaselinePoints(parsedTrack.points);
  const course: RaceCourse = {
    checkpoints,
    baselineTrack: baselinePoints.length >= 2 ? { points: baselinePoints } : undefined
  };
  return {
    course,
    plannedPaceSecondsPerKm: parsedTrack.averagePaceSecondsPerKm
  };
}

export function buildExpectedAidStationSplitsFromCourse(
  course: RaceCourse,
  plannedPaceSecondsPerKm: number,
  unit: DistanceUnit
): { totalDistanceMeters: number; totalDurationSeconds: number; splits: ExpectedSplit[] } {
  if (course.checkpoints.length < 2) {
    return { totalDistanceMeters: 0, totalDurationSeconds: 0, splits: [] };
  }

  const checkpointDistances = buildCheckpointCumulativeDistances(course);
  const totalDistanceMeters =
    course.baselineTrack?.points?.[course.baselineTrack.points.length - 1]?.distanceMetersFromStart ??
    checkpointDistances[checkpointDistances.length - 1] ??
    0;
  const totalDurationSeconds =
    course.baselineTrack?.points?.[course.baselineTrack.points.length - 1]?.referenceElapsedSeconds ??
    (totalDistanceMeters / METERS_PER_KILOMETER) * plannedPaceSecondsPerKm;

  const splits = checkpointDistances.map((distanceFromStart, index) => {
    const elapsedSeconds = estimateElapsedAtDistance(course, distanceFromStart, plannedPaceSecondsPerKm);
    const checkpoint = course.checkpoints[index]!;
    const distanceLabel = `${checkpoint.id} • ${formatDistance(distanceFromStart, unit)}`;
    return {
      splitIndex: index + 1,
      distanceKm: distanceFromStart / METERS_PER_KILOMETER,
      distanceLabel,
      elapsedSeconds,
      elapsedLabel: formatDuration(elapsedSeconds)
    };
  });

  return { totalDistanceMeters, totalDurationSeconds, splits };
}

function extractTrackPoints(gpxXml: string): GpxTrackPoint[] {
  const trackPointPattern = /<(?:[\w-]+:)?(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?(?:trkpt|rtept)>/gi;
  const points: GpxTrackPoint[] = [];

  for (const match of gpxXml.matchAll(trackPointPattern)) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const latitude = extractCoordinate(attributes, "lat");
    const longitude = extractCoordinate(attributes, "lon");
    const elevationMeters = extractOptionalNumericTag(body, "ele");
    const timestampMs = extractOptionalTimestamp(body);

    if (latitude === null || longitude === null) {
      continue;
    }

    points.push({ latitude, longitude, elevationMeters, timestampMs });
  }

  return points;
}

function extractKmlTrackPoints(kml: string): GpxTrackPoint[] {
  const coordinatePattern = /<coordinates>\s*([^<]+)\s*<\/coordinates>/gi;
  const points: GpxTrackPoint[] = [];
  for (const match of kml.matchAll(coordinatePattern)) {
    const payload = (match[1] ?? "").trim();
    if (!payload) continue;
    const chunks = payload.split(/\s+/);
    for (const chunk of chunks) {
      const [lonRaw, latRaw, eleRaw] = chunk.split(",");
      const latitude = Number.parseFloat(latRaw ?? "");
      const longitude = Number.parseFloat(lonRaw ?? "");
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        continue;
      }
      const elevationMeters = Number.isFinite(Number.parseFloat(eleRaw ?? ""))
        ? Number.parseFloat(eleRaw ?? "")
        : null;
      points.push({ latitude, longitude, elevationMeters, timestampMs: null });
    }
  }
  return points;
}

function extractJsonTrackPoints(input: unknown): GpxTrackPoint[] {
  if (Array.isArray(input)) {
    const points = input
      .map((entry) => toTrackPoint(entry))
      .filter((entry): entry is GpxTrackPoint => entry !== null);
    if (points.length >= 2) return points;
  }

  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    const geo = extractFromGeoJson(rec);
    if (geo.length >= 2) return geo;

    if (Array.isArray(rec.points)) {
      const points = rec.points
        .map((entry) => toTrackPoint(entry))
        .filter((entry): entry is GpxTrackPoint => entry !== null);
      if (points.length >= 2) return points;
    }

    const deepCandidates = findCoordinateArraysDeep(rec);
    for (const candidate of deepCandidates) {
      const points = candidate
        .map((entry) => toTrackPoint(entry))
        .filter((entry): entry is GpxTrackPoint => entry !== null);
      if (points.length >= 2) {
        return points;
      }
    }
  }

  return [];
}

function findCoordinateArraysDeep(input: unknown, depth = 0): unknown[][] {
  if (depth > 8 || input === null || input === undefined) {
    return [];
  }
  if (Array.isArray(input)) {
    const isCoordinateArray = input.length >= 2 && input.every((entry) => toTrackPoint(entry) !== null);
    if (isCoordinateArray) {
      return [input];
    }
    return input.flatMap((entry) => findCoordinateArraysDeep(entry, depth + 1));
  }
  if (typeof input === "object") {
    return Object.values(input as Record<string, unknown>).flatMap((value) =>
      findCoordinateArraysDeep(value, depth + 1)
    );
  }
  return [];
}

function extractFromGeoJson(node: Record<string, unknown>): GpxTrackPoint[] {
  const type = typeof node.type === "string" ? node.type : undefined;

  if (type === "FeatureCollection" && Array.isArray(node.features)) {
    for (const feature of node.features) {
      if (!feature || typeof feature !== "object") continue;
      const points = extractFromGeoJson(feature as Record<string, unknown>);
      if (points.length >= 2) return points;
    }
    return [];
  }

  if (type === "Feature" && node.geometry && typeof node.geometry === "object") {
    return extractFromGeoJson(node.geometry as Record<string, unknown>);
  }

  if (type === "LineString" && Array.isArray(node.coordinates)) {
    return node.coordinates
      .map((coord) => toTrackPoint(coord))
      .filter((entry): entry is GpxTrackPoint => entry !== null);
  }

  if (type === "MultiLineString" && Array.isArray(node.coordinates)) {
    for (const line of node.coordinates) {
      if (!Array.isArray(line)) continue;
      const points = line.map((coord) => toTrackPoint(coord)).filter((entry): entry is GpxTrackPoint => entry !== null);
      if (points.length >= 2) return points;
    }
  }

  return [];
}

function toTrackPoint(value: unknown): GpxTrackPoint | null {
  if (Array.isArray(value) && value.length >= 2) {
    const longitude = Number.parseFloat(String(value[0]));
    const latitude = Number.parseFloat(String(value[1]));
    const elevationMeters = value.length > 2 && Number.isFinite(Number.parseFloat(String(value[2])))
      ? Number.parseFloat(String(value[2]))
      : null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    return { latitude, longitude, elevationMeters, timestampMs: null };
  }

  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const latitude = Number.parseFloat(String(rec.latitude ?? rec.lat ?? ""));
    const longitude = Number.parseFloat(String(rec.longitude ?? rec.lon ?? rec.lng ?? ""));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    return { latitude, longitude, elevationMeters: null, timestampMs: null };
  }

  return null;
}

type GpxWaypoint = {
  latitude: number;
  longitude: number;
  name?: string;
};

function extractWaypointsFromXml(gpxXml: string): GpxWaypoint[] {
  const waypointPattern = /<(?:[\w-]+:)?wpt\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?wpt>/gi;
  const waypoints: GpxWaypoint[] = [];

  for (const match of gpxXml.matchAll(waypointPattern)) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const latitude = extractCoordinate(attributes, "lat");
    const longitude = extractCoordinate(attributes, "lon");
    if (latitude === null || longitude === null) {
      continue;
    }
    const nameMatch = body.match(/<(?:[\w-]+:)?name>\s*([^<]+)\s*<\/(?:[\w-]+:)?name>/i);
    waypoints.push({
      latitude,
      longitude,
      ...(nameMatch ? { name: nameMatch[1].trim() } : {})
    });
  }

  return waypoints;
}

function extractKmlWaypoints(kml: string): GpxWaypoint[] {
  const waypointPattern =
    /<Placemark[\s\S]*?<name>\s*([^<]+)\s*<\/name>[\s\S]*?<Point>[\s\S]*?<coordinates>\s*([^<]+)\s*<\/coordinates>[\s\S]*?<\/Point>[\s\S]*?<\/Placemark>/gi;
  const waypoints: GpxWaypoint[] = [];
  for (const match of kml.matchAll(waypointPattern)) {
    const name = (match[1] ?? "").trim();
    const [lonRaw, latRaw] = (match[2] ?? "").trim().split(",");
    const latitude = Number.parseFloat(latRaw ?? "");
    const longitude = Number.parseFloat(lonRaw ?? "");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }
    waypoints.push({ latitude, longitude, name });
  }
  return waypoints;
}

function buildFallbackCheckpoints(points: GpxTrackPoint[]): RaceCourse["checkpoints"] {
  const count = Math.min(6, Math.max(2, Math.floor(points.length / 20)));
  if (count <= 2) {
    return [
      { id: "aid-1", latitude: points[0]!.latitude, longitude: points[0]!.longitude, plannedStopSeconds: 120 },
      {
        id: "aid-2",
        latitude: points[points.length - 1]!.latitude,
        longitude: points[points.length - 1]!.longitude,
        plannedStopSeconds: 120
      }
    ];
  }

  return Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    const pointIndex = Math.round(ratio * (points.length - 1));
    const point = points[pointIndex]!;
    return {
      id: `aid-${index + 1}`,
      latitude: point.latitude,
      longitude: point.longitude,
      plannedStopSeconds: 120
    };
  });
}

function sanitizeCheckpointId(name: string | undefined, index: number): string {
  if (!name) {
    return `aid-${index}`;
  }
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : `aid-${index}`;
}

function buildCheckpointCumulativeDistances(course: RaceCourse): number[] {
  const distances: number[] = [];
  let cumulative = 0;
  for (let index = 0; index < course.checkpoints.length; index += 1) {
    if (index > 0) {
      cumulative += haversineDistanceMeters(course.checkpoints[index - 1]!, course.checkpoints[index]!);
    }
    distances.push(cumulative);
  }
  return distances;
}

function estimateElapsedAtDistance(course: RaceCourse, distanceMeters: number, plannedPaceSecondsPerKm: number): number {
  const baseline = course.baselineTrack?.points;
  if (!baseline || baseline.length < 2) {
    return (distanceMeters / METERS_PER_KILOMETER) * plannedPaceSecondsPerKm;
  }

  if (distanceMeters <= baseline[0]!.distanceMetersFromStart) {
    return baseline[0]!.referenceElapsedSeconds;
  }

  for (let index = 1; index < baseline.length; index += 1) {
    const prev = baseline[index - 1]!;
    const next = baseline[index]!;
    if (distanceMeters <= next.distanceMetersFromStart) {
      const span = next.distanceMetersFromStart - prev.distanceMetersFromStart;
      if (span <= 0) {
        return next.referenceElapsedSeconds;
      }
      const ratio = (distanceMeters - prev.distanceMetersFromStart) / span;
      return prev.referenceElapsedSeconds + ratio * (next.referenceElapsedSeconds - prev.referenceElapsedSeconds);
    }
  }

  return baseline[baseline.length - 1]!.referenceElapsedSeconds;
}

function buildBaselinePoints(points: GpxTrackPoint[]): Array<{
  distanceMetersFromStart: number;
  referenceElapsedSeconds: number;
}> {
  if (points.length < 2) {
    return [];
  }

  const baseline: Array<{ distanceMetersFromStart: number; referenceElapsedSeconds: number }> = [];
  let distanceMetersFromStart = 0;
  const firstTimestamp = points[0]!.timestampMs;

  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) {
      distanceMetersFromStart += haversineDistanceMeters(points[index - 1]!, points[index]!);
    }

    const pointTimestamp = points[index]!.timestampMs;
    const referenceElapsedSeconds =
      firstTimestamp !== null && pointTimestamp !== null ? Math.max(0, (pointTimestamp - firstTimestamp) / 1000) : 0;
    baseline.push({ distanceMetersFromStart, referenceElapsedSeconds });
  }

  return downsampleBaselinePoints(baseline, MAX_BASELINE_POINTS);
}

function downsampleBaselinePoints(
  points: Array<{ distanceMetersFromStart: number; referenceElapsedSeconds: number }>,
  maxPoints: number
): Array<{ distanceMetersFromStart: number; referenceElapsedSeconds: number }> {
  if (points.length <= maxPoints) {
    return points;
  }

  const sampled: Array<{ distanceMetersFromStart: number; referenceElapsedSeconds: number }> = [];
  sampled.push(points[0]!);
  const interiorTarget = Math.max(0, maxPoints - 2);
  for (let i = 1; i <= interiorTarget; i += 1) {
    const index = Math.round((i * (points.length - 1)) / (interiorTarget + 1));
    sampled.push(points[index]!);
  }
  sampled.push(points[points.length - 1]!);
  return sampled;
}

function buildParsedTrackFromPoints(points: GpxTrackPoint[], waypoints: GpxWaypoint[]): ParsedGpxTrack {
  const totalDistanceMeters = calculateTotalDistance(points);
  if (totalDistanceMeters <= 0) {
    throw new Error("Route distance is zero. Use a file with movement data.");
  }
  const timing = deriveTimingFromPoints(points, totalDistanceMeters);

  return {
    points,
    waypoints,
    totalDistanceMeters,
    startTimestampMs: timing.startTimestampMs,
    endTimestampMs: timing.endTimestampMs,
    totalDurationSeconds: timing.totalDurationSeconds,
    averagePaceSecondsPerKm: timing.totalDurationSeconds / (totalDistanceMeters / METERS_PER_KILOMETER)
  };
}

function deriveTimingFromPoints(
  points: GpxTrackPoint[],
  totalDistanceMeters: number
): { startTimestampMs: number; endTimestampMs: number; totalDurationSeconds: number } {
  const timestamps = points.map((point) => point.timestampMs).filter((value): value is number => value !== null);
  const fallbackDurationSeconds = Math.max(
    1,
    (totalDistanceMeters / METERS_PER_KILOMETER) * DEFAULT_PACE_SECONDS_PER_KM
  );
  if (timestamps.length < 2) {
    return {
      startTimestampMs: 0,
      endTimestampMs: fallbackDurationSeconds * 1000,
      totalDurationSeconds: fallbackDurationSeconds
    };
  }
  const startTimestampMs = timestamps[0];
  const endTimestampMs = timestamps[timestamps.length - 1];
  const totalDurationSeconds = (endTimestampMs - startTimestampMs) / 1000;
  if (!Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0) {
    return {
      startTimestampMs: 0,
      endTimestampMs: fallbackDurationSeconds * 1000,
      totalDurationSeconds: fallbackDurationSeconds
    };
  }
  return { startTimestampMs, endTimestampMs, totalDurationSeconds };
}

function extractCoordinate(attributes: string, key: "lat" | "lon"): number | null {
  const match = attributes.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`, "i"));
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractOptionalNumericTag(body: string, tagName: string): number | null {
  const match = body.match(new RegExp(`<(?:[\\w-]+:)?${tagName}>\\s*([^<]+)\\s*<\\/(?:[\\w-]+:)?${tagName}>`, "i"));
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractOptionalTimestamp(body: string): number | null {
  const match = body.match(/<(?:[\w-]+:)?time>\s*([^<]+)\s*<\/(?:[\w-]+:)?time>/i);
  if (!match) {
    return null;
  }

  const timestampMs = Date.parse(match[1]);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function calculateTotalDistance(points: GpxTrackPoint[]): number {
  let totalMeters = 0;

  for (let index = 1; index < points.length; index += 1) {
    totalMeters += haversineDistanceMeters(points[index - 1], points[index]);
  }

  return totalMeters;
}

function haversineDistanceMeters(
  previous: Pick<GpxTrackPoint, "latitude" | "longitude">,
  current: Pick<GpxTrackPoint, "latitude" | "longitude">
): number {
  const earthRadiusMeters = 6371000;
  const lat1 = toRadians(previous.latitude);
  const lat2 = toRadians(current.latitude);
  const deltaLat = toRadians(current.latitude - previous.latitude);
  const deltaLon = toRadians(current.longitude - previous.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
