export type GpxTrackPoint = {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  timestampMs: number | null;
};

export type ParsedGpxTrack = {
  points: GpxTrackPoint[];
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

const METERS_PER_KILOMETER = 1000;
const METERS_PER_MILE = 1609.344;

export function parseGpxTrack(gpxXml: string): ParsedGpxTrack {
  if (!gpxXml.trim()) {
    throw new Error("GPX file is empty. Export a valid GPX track and try again.");
  }

  const points = extractTrackPoints(gpxXml);
  if (points.length < 2) {
    throw new Error("GPX must include at least two track points.");
  }

  const totalDistanceMeters = calculateTotalDistance(points);
  if (totalDistanceMeters <= 0) {
    throw new Error("GPX track distance is zero. Use a GPX with movement data.");
  }

  const timestamps = points.map((point) => point.timestampMs).filter((value): value is number => value !== null);
  if (timestamps.length < 2) {
    throw new Error("GPX track is missing timestamps required for expected split times.");
  }

  const startTimestampMs = timestamps[0];
  const endTimestampMs = timestamps[timestamps.length - 1];
  const totalDurationSeconds = (endTimestampMs - startTimestampMs) / 1000;
  if (totalDurationSeconds <= 0) {
    throw new Error("GPX timestamps are invalid. Ensure track time moves forward.");
  }

  return {
    points,
    totalDistanceMeters,
    startTimestampMs,
    endTimestampMs,
    totalDurationSeconds,
    averagePaceSecondsPerKm: totalDurationSeconds / (totalDistanceMeters / METERS_PER_KILOMETER)
  };
}

export function buildExpectedSplits(
  parsedTrack: ParsedGpxTrack,
  unit: "km" | "mi" = "km"
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

export function formatPace(secondsPerKm: number): string {
  return `${formatDuration(secondsPerKm)}/km`;
}

export function formatDistanceKm(distanceMeters: number): string {
  return `${(distanceMeters / METERS_PER_KILOMETER).toFixed(2)} km`;
}

function extractTrackPoints(gpxXml: string): GpxTrackPoint[] {
  const trackPointPattern = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
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

function extractCoordinate(attributes: string, key: "lat" | "lon"): number | null {
  const match = attributes.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`, "i"));
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractOptionalNumericTag(body: string, tagName: string): number | null {
  const match = body.match(new RegExp(`<${tagName}>\\s*([^<]+)\\s*<\\/${tagName}>`, "i"));
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractOptionalTimestamp(body: string): number | null {
  const match = body.match(/<time>\s*([^<]+)\s*<\/time>/i);
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
