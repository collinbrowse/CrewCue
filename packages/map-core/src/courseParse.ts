import type { RaceCourse, RaceCourseBaselineTrack, RaceCourseCheckpointCutoff } from "@crewcue/contracts";

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
const WAYPOINT_ENCOUNTER_RADIUS_METERS = 80;
const WAYPOINT_ENCOUNTER_MIN_GAP_METERS = 200;
/**
 * Segment-wise closest approach is recorded when within this distance, so a trail track that never
 * enters the 80 m "inside" pocket still yields a visit. Merged with {@link WAYPOINT_ENCOUNTER_MIN_GAP_METERS}
 * along-route so winding near an aid does not create duplicate passes.
 */
const WAYPOINT_APPROACH_MAX_DISTANCE_METERS = 155;
/**
 * When the 80 m pocket records only one crossing but segment analysis finds two well-separated
 * approaches (≥ this span in meters), treat the waypoint as visited twice (e.g. out-and-back aid).
 * Keeps single-pass stations from gaining spurious second hits when the route winds nearby twice.
 */
const WAYPOINT_SECOND_PASS_MIN_SPAN_METERS = 15_000;
/** Default planned aid stop when importing or synthesizing checkpoints (10 minutes). */
export const DEFAULT_CHECKPOINT_PLANNED_STOP_SECONDS = 600;

const CUTOFF_HINT_RE =
  /(cutoff|cut-off|\bcut\b|deadline|time\s*limit|must\s*leave|closes\s*at|close\s*at)/i;

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

export type ParseGpxTrackProgress = {
  /** 0..1 across point extraction (and optional waypoint scan). */
  ratio: number;
};

export type ParseGpxTrackAsyncOptions = {
  /** Defaults to true. Activity history can skip waypoints for speed. */
  includeWaypoints?: boolean;
  /** Called periodically so UIs can paint a determinate bar. */
  onProgress?: (progress: ParseGpxTrackProgress) => void | Promise<void>;
  /** Yield to the event loop after this many track points (default 300). */
  yieldEveryPoints?: number;
};

/**
 * Async GPX parse with progress. Same result shape as {@link parseGpxTrack}.
 * Progress is driven by regex scan position through the XML (point extraction).
 */
export async function parseGpxTrackAsync(
  gpxXml: string,
  options?: ParseGpxTrackAsyncOptions
): Promise<ParsedGpxTrack> {
  const normalizedXml = gpxXml.replace(/^\uFEFF/, "");
  if (!normalizedXml.trim()) {
    throw new Error("GPX file is empty. Export a valid GPX track and try again.");
  }

  const includeWaypoints = options?.includeWaypoints !== false;
  const yieldEveryPoints = options?.yieldEveryPoints ?? 300;
  const onProgress = options?.onProgress;

  const points = await extractTrackPointsProgressive(normalizedXml, {
    onProgress: async (extractRatio) => {
      // Reserve the top of the bar for waypoint/distance finish work.
      await onProgress?.({ ratio: extractRatio * (includeWaypoints ? 0.85 : 0.92) });
    },
    yieldEveryPoints
  });

  if (points.length < 2) {
    throw new Error("GPX must include at least two track points.");
  }

  await onProgress?.({ ratio: includeWaypoints ? 0.88 : 0.94 });
  const waypoints = includeWaypoints ? extractWaypointsFromXml(normalizedXml) : [];

  await onProgress?.({ ratio: 0.96 });
  const totalDistanceMeters = calculateTotalDistance(points);
  if (totalDistanceMeters <= 0) {
    throw new Error("GPX track distance is zero. Use a GPX with movement data.");
  }
  const timing = deriveTimingFromPoints(points, totalDistanceMeters);
  await onProgress?.({ ratio: 1 });

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

  return buildParsedTrackFromPoints(points, extractJsonWaypoints(parsedJson));
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

type SelectedWaypointEncounter = {
  waypoint: GpxWaypoint;
  /** Haversine cumulative distance at encounter along the parsed track (import hint for projection). */
  encounterMetersFromStart: number;
};

export function buildRaceCourseFromGpx(parsedTrack: ParsedGpxTrack): {
  course: RaceCourse;
  plannedPaceSecondsPerKm: number;
} {
  const selectedEncounters = selectCheckpointWaypoints(parsedTrack.points, parsedTrack.waypoints);
  const seenIds = new Set<string>();
  const checkpoints =
    selectedEncounters.length >= 2
      ? selectedEncounters.map((row, index) => {
          const waypoint = row.waypoint;
          const id = uniqueCheckpointId(sanitizeCheckpointId(waypoint.name, index + 1), seenIds);
          const cutoff = tryParseCheckpointCutoffFromDescription(waypoint.description);
          const title = waypoint.name?.trim() ? waypoint.name.trim() : slugToTitle(id);
          return {
            id,
            title,
            latitude: waypoint.latitude,
            longitude: waypoint.longitude,
            plannedStopSeconds: DEFAULT_CHECKPOINT_PLANNED_STOP_SECONDS,
            distanceMetersFromStart: row.encounterMetersFromStart,
            ...(cutoff ? { cutoff } : {})
          };
        })
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

async function extractTrackPointsProgressive(
  gpxXml: string,
  options: {
    onProgress?: (ratio: number) => void | Promise<void>;
    yieldEveryPoints: number;
  }
): Promise<GpxTrackPoint[]> {
  const trackPointPattern = /<(?:[\w-]+:)?(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?(?:trkpt|rtept)>/gi;
  const points: GpxTrackPoint[] = [];
  const totalBytes = Math.max(1, gpxXml.length);
  let sinceYield = 0;
  let match: RegExpExecArray | null;

  while ((match = trackPointPattern.exec(gpxXml)) !== null) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const latitude = extractCoordinate(attributes, "lat");
    const longitude = extractCoordinate(attributes, "lon");
    const elevationMeters = extractOptionalNumericTag(body, "ele");
    const timestampMs = extractOptionalTimestamp(body);

    if (latitude !== null && longitude !== null) {
      points.push({ latitude, longitude, elevationMeters, timestampMs });
    }

    sinceYield += 1;
    if (sinceYield >= options.yieldEveryPoints) {
      sinceYield = 0;
      const ratio = Math.min(1, trackPointPattern.lastIndex / totalBytes);
      await options.onProgress?.(ratio);
      // Let React Native paint between heavy regex batches.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  await options.onProgress?.(1);
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

export type GpxWaypoint = {
  latitude: number;
  longitude: number;
  name?: string;
  /** GPX/KML/JSON description text; used for best-effort cutoff parsing. */
  description?: string;
};

/**
 * Best-effort parse of a cutoff from free-form marker description text.
 * Returns undefined when no cutoff-like hint is found or parsing fails.
 */
export function tryParseCheckpointCutoffFromDescription(raw: string | undefined): RaceCourseCheckpointCutoff | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const text = raw.trim();
  if (!CUTOFF_HINT_RE.test(text)) {
    return undefined;
  }

  const lower = text.toLowerCase();
  const fromStartHint = /(from\s*start|after\s*start|elapsed|time\s*in)/i.test(lower);

  const ampm = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
  if (ampm) {
    let hour = Number.parseInt(ampm[1]!, 10);
    const minute = Number.parseInt(ampm[2]!, 10);
    const mer = ampm[3]!.toLowerCase();
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
      return undefined;
    }
    if (mer === "pm" && hour < 12) {
      hour += 12;
    }
    if (mer === "am" && hour === 12) {
      hour = 0;
    }
    if (hour < 0 || hour > 23) {
      return undefined;
    }
    return { mode: "time_of_day", hour, minute };
  }

  const hms = text.match(/\b(\d{1,3}):(\d{2}):(\d{2})\b/);
  if (hms) {
    const h = Number.parseInt(hms[1]!, 10);
    const m = Number.parseInt(hms[2]!, 10);
    const s = Number.parseInt(hms[3]!, 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s) || m > 59 || s > 59) {
      return undefined;
    }
    if (h > 23 || fromStartHint) {
      const seconds = h * 3600 + m * 60 + s;
      return { mode: "elapsed_from_start", seconds };
    }
    return { mode: "time_of_day", hour: h, minute: m };
  }

  const hm = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) {
    const h = Number.parseInt(hm[1]!, 10);
    const m = Number.parseInt(hm[2]!, 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59) {
      return undefined;
    }
    if (fromStartHint || h > 23) {
      const seconds = h * 3600 + m * 60;
      return { mode: "elapsed_from_start", seconds };
    }
    return { mode: "time_of_day", hour: h, minute: m };
  }

  const hoursMinutes = text.match(/\b(\d+)\s*h(?:\s*(\d+)\s*m)?\b/i);
  if (hoursMinutes) {
    const h = Number.parseInt(hoursMinutes[1]!, 10);
    const mPart = hoursMinutes[2];
    const m = mPart ? Number.parseInt(mPart, 10) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59) {
      return undefined;
    }
    return { mode: "elapsed_from_start", seconds: h * 3600 + m * 60 };
  }

  return undefined;
}

/** Turn a stable checkpoint id slug into Title Case words (for UI when `title` is missing). */
export function slugToTitle(slug: string): string {
  const t = slug.replace(/-/g, " ").trim();
  if (!t) {
    return slug;
  }
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractWaypointDescription(body: string): string | undefined {
  const desc = body.match(/<(?:[\w-]+:)?desc>\s*([^<]*)\s*<\/(?:[\w-]+:)?desc>/i);
  if (desc?.[1]?.trim()) {
    return desc[1].trim();
  }
  const description = body.match(/<(?:[\w-]+:)?description>\s*([^<]*)\s*<\/(?:[\w-]+:)?description>/i);
  if (description?.[1]?.trim()) {
    return description[1].trim();
  }
  return undefined;
}

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
    const description = extractWaypointDescription(body);
    waypoints.push({
      latitude,
      longitude,
      ...(nameMatch ? { name: nameMatch[1].trim() } : {}),
      ...(description ? { description } : {})
    });
  }

  return waypoints;
}

function extractKmlWaypoints(kml: string): GpxWaypoint[] {
  const waypointPattern =
    /<Placemark[\s\S]*?<name>\s*([^<]+)\s*<\/name>[\s\S]*?<Point>[\s\S]*?<coordinates>\s*([^<]+)\s*<\/coordinates>[\s\S]*?<\/Point>[\s\S]*?<\/Placemark>/gi;
  const waypoints: GpxWaypoint[] = [];
  for (const match of kml.matchAll(waypointPattern)) {
    const block = match[0] ?? "";
    const name = (match[1] ?? "").trim();
    const [lonRaw, latRaw] = (match[2] ?? "").trim().split(",");
    const latitude = Number.parseFloat(latRaw ?? "");
    const longitude = Number.parseFloat(lonRaw ?? "");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }
    const description = extractWaypointDescription(block);
    waypoints.push({ latitude, longitude, name, ...(description ? { description } : {}) });
  }
  return waypoints;
}

function extractJsonWaypoints(input: unknown): GpxWaypoint[] {
  const candidates: GpxWaypoint[] = [];
  if (!input || typeof input !== "object") {
    return candidates;
  }
  const root = input as Record<string, unknown>;
  candidates.push(...extractPointFeaturesFromGeoJson(root));
  for (const key of ["waypoints", "markers", "checkpoints", "aidStations", "aid_stations"] as const) {
    const list = root[key];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      const waypoint = toWaypoint(entry);
      if (waypoint) {
        candidates.push(waypoint);
      }
    }
  }
  return dedupeWaypoints(candidates);
}

function extractPointFeaturesFromGeoJson(node: Record<string, unknown>): GpxWaypoint[] {
  const type = typeof node.type === "string" ? node.type : "";
  if (type === "FeatureCollection" && Array.isArray(node.features)) {
    return node.features.flatMap((feature) =>
      feature && typeof feature === "object" ? extractPointFeaturesFromGeoJson(feature as Record<string, unknown>) : []
    );
  }
  if (type === "Feature") {
    const props = node.properties && typeof node.properties === "object" ? (node.properties as Record<string, unknown>) : {};
    const name =
      (typeof props.name === "string" && props.name) ||
      (typeof props.title === "string" && props.title) ||
      (typeof props.id === "string" && props.id) ||
      undefined;
    const descRaw = props.description ?? props.desc;
    const description = typeof descRaw === "string" ? descRaw.trim() : undefined;
    const geometry = node.geometry && typeof node.geometry === "object" ? (node.geometry as Record<string, unknown>) : null;
    if (!geometry) {
      return [];
    }
    const point = toWaypointFromGeometry(geometry, name);
    if (!point) {
      return [];
    }
    return description ? [{ ...point, description }] : [point];
  }
  return [];
}

function toWaypointFromGeometry(geometry: Record<string, unknown>, name?: string): GpxWaypoint | null {
  const type = typeof geometry.type === "string" ? geometry.type : "";
  if (type !== "Point" || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  return toWaypoint({ coordinates: geometry.coordinates, name });
}

function toWaypoint(value: unknown): GpxWaypoint | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const coords = record.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const longitude = Number.parseFloat(String(coords[0]));
    const latitude = Number.parseFloat(String(coords[1]));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    const name = typeof record.name === "string" ? record.name.trim() : undefined;
    const descRaw = record.description ?? record.desc;
    const description = typeof descRaw === "string" ? descRaw.trim() : undefined;
    return { latitude, longitude, ...(name ? { name } : {}), ...(description ? { description } : {}) };
  }
  const latitude = Number.parseFloat(String(record.latitude ?? record.lat ?? ""));
  const longitude = Number.parseFloat(String(record.longitude ?? record.lon ?? record.lng ?? ""));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const nameRaw = record.name ?? record.title ?? record.label ?? record.id;
  const name = typeof nameRaw === "string" ? nameRaw.trim() : undefined;
  const descRaw = record.description ?? record.desc;
  const description = typeof descRaw === "string" ? descRaw.trim() : undefined;
  return { latitude, longitude, ...(name ? { name } : {}), ...(description ? { description } : {}) };
}

function dedupeWaypoints(waypoints: GpxWaypoint[]): GpxWaypoint[] {
  const seen = new Set<string>();
  const deduped: GpxWaypoint[] = [];
  for (const waypoint of waypoints) {
    const key = `${waypoint.latitude.toFixed(6)}|${waypoint.longitude.toFixed(6)}|${(waypoint.name ?? "").toLowerCase()}|${(waypoint.description ?? "").toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(waypoint);
  }
  return deduped;
}

function selectCheckpointWaypoints(points: GpxTrackPoint[], candidates: GpxWaypoint[]): SelectedWaypointEncounter[] {
  if (candidates.length < 2) {
    const expandedSingle = expandWaypointEncounters(points, candidates);
    if (expandedSingle.length < 2) {
      return [];
    }
    return expandedSingle.map((entry) => ({
      waypoint: entry.candidate,
      encounterMetersFromStart: entry.distanceMetersFromStart
    }));
  }
  const stationLike = candidates.filter((candidate) => isStationLikeName(candidate.name));
  const pool = stationLike.length > 0 ? stationLike : candidates;
  const expanded = expandWaypointEncounters(points, pool);
  if (expanded.length < 2) {
    return [];
  }
  const enriched = [...expanded].sort((a, b) => a.distanceMetersFromStart - b.distanceMetersFromStart);

  const startAnchor = enriched.find((entry) => isStartName(entry.candidate.name));
  const finishAnchor = [...enriched].reverse().find((entry) => isFinishName(entry.candidate.name));
  const resolvedFinishAnchor =
    startAnchor && finishAnchor && startAnchor === finishAnchor
      ? {
          candidate: {
            latitude: points[points.length - 1]!.latitude,
            longitude: points[points.length - 1]!.longitude,
            name: "Finish"
          },
          distanceMetersFromStart: calculateTotalDistance(points)
        }
      : finishAnchor;
  const body: SelectedWaypointEncounter[] = enriched
    .filter((entry) => entry !== startAnchor && entry !== finishAnchor)
    .map((entry) => ({
      waypoint: entry.candidate,
      encounterMetersFromStart: entry.distanceMetersFromStart
    }));
  const ordered: SelectedWaypointEncounter[] = [];
  if (startAnchor) {
    ordered.push({
      waypoint: startAnchor.candidate,
      encounterMetersFromStart: startAnchor.distanceMetersFromStart
    });
  }
  ordered.push(...body);
  if (resolvedFinishAnchor) {
    ordered.push({
      waypoint: resolvedFinishAnchor.candidate,
      encounterMetersFromStart: resolvedFinishAnchor.distanceMetersFromStart
    });
  }
  return ordered.length >= 2 ? ordered : [];
}

function expandWaypointEncounters(
  points: GpxTrackPoint[],
  candidates: GpxWaypoint[]
): Array<{ candidate: GpxWaypoint; distanceMetersFromStart: number }> {
  return candidates.flatMap((candidate) => {
    const progresses = waypointEncounterProgresses(points, candidate);
    return progresses.map((distanceMetersFromStart) => ({ candidate, distanceMetersFromStart }));
  });
}

function waypointEncounterProgresses(points: GpxTrackPoint[], candidate: GpxWaypoint): number[] {
  if (points.length < 2) {
    return [0];
  }
  const cumulativeAtPoints: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeAtPoints.push(cumulativeAtPoints[index - 1]! + haversineDistanceMeters(points[index - 1]!, points[index]!));
  }

  const insideHits: number[] = [];
  let inside = false;
  let lastEncounter = -Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const progress = cumulativeAtPoints[index]!;
    const distanceToWaypoint = haversineDistanceMeters(point, candidate);
    const isInside = distanceToWaypoint <= WAYPOINT_ENCOUNTER_RADIUS_METERS;
    if (isInside && !inside && progress - lastEncounter >= WAYPOINT_ENCOUNTER_MIN_GAP_METERS) {
      insideHits.push(progress);
      lastEncounter = progress;
    }
    inside = isInside;
  }

  const segmentHits = segmentApproachProgressesFromCumulative(points, candidate, cumulativeAtPoints);

  if (insideHits.length >= 2) {
    return insideHits;
  }
  if (insideHits.length === 1) {
    if (segmentHits.length >= 2) {
      const spanMeters = segmentHits[segmentHits.length - 1]! - segmentHits[0]!;
      if (spanMeters >= WAYPOINT_SECOND_PASS_MIN_SPAN_METERS) {
        return segmentHits.slice(0, Math.min(segmentHits.length, 2));
      }
    }
    return insideHits;
  }
  if (segmentHits.length > 0) {
    return segmentHits;
  }
  return [distanceAlongTrack(points, candidate)];
}

function segmentApproachProgressesFromCumulative(
  points: GpxTrackPoint[],
  candidate: GpxWaypoint,
  cumulativeAtPoints: number[]
): number[] {
  const samples: Array<{ progress: number; distanceMeters: number }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const segmentLength = haversineDistanceMeters(previous, current);
    if (segmentLength <= 0) {
      continue;
    }
    const projectionRatio = projectionRatioOnSegment(previous, current, candidate);
    const projected = {
      latitude: previous.latitude + (current.latitude - previous.latitude) * projectionRatio,
      longitude: previous.longitude + (current.longitude - previous.longitude) * projectionRatio
    };
    const candidateDistance = haversineDistanceMeters(projected, candidate);
    if (candidateDistance <= WAYPOINT_APPROACH_MAX_DISTANCE_METERS) {
      const cumA = cumulativeAtPoints[index - 1]!;
      samples.push({ progress: cumA + segmentLength * projectionRatio, distanceMeters: candidateDistance });
    }
  }

  samples.sort((a, b) => a.progress - b.progress);
  const merged: Array<{ progress: number; distanceMeters: number }> = [];
  for (const sample of samples) {
    if (merged.length === 0) {
      merged.push(sample);
      continue;
    }
    const last = merged[merged.length - 1]!;
    if (sample.progress - last.progress >= WAYPOINT_ENCOUNTER_MIN_GAP_METERS) {
      merged.push(sample);
    } else if (sample.distanceMeters < last.distanceMeters) {
      merged[merged.length - 1] = sample;
    }
  }

  return merged.map((s) => s.progress);
}

function isStationLikeName(name: string | undefined): boolean {
  if (!name) {
    return false;
  }
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return /\b(aid|station|checkpoint|cp|water|crew|start|finish)\b/.test(normalized);
}

function isStartName(name: string | undefined): boolean {
  if (!name) {
    return false;
  }
  return /\b(start|begin)\b/i.test(name);
}

function isFinishName(name: string | undefined): boolean {
  if (!name) {
    return false;
  }
  return /\b(finish|end)\b/i.test(name);
}

function distanceAlongTrack(points: GpxTrackPoint[], candidate: GpxWaypoint): number {
  if (points.length < 2) {
    return 0;
  }
  let cumulative = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const segmentLength = haversineDistanceMeters(previous, current);
    const projectionRatio = projectionRatioOnSegment(previous, current, candidate);
    const projected = {
      latitude: previous.latitude + (current.latitude - previous.latitude) * projectionRatio,
      longitude: previous.longitude + (current.longitude - previous.longitude) * projectionRatio
    };
    const candidateDistance = haversineDistanceMeters(projected, candidate);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestProgress = cumulative + segmentLength * projectionRatio;
    }
    cumulative += segmentLength;
  }
  return bestProgress;
}

function projectionRatioOnSegment(
  start: Pick<GpxTrackPoint, "latitude" | "longitude">,
  end: Pick<GpxTrackPoint, "latitude" | "longitude">,
  point: Pick<GpxWaypoint, "latitude" | "longitude">
): number {
  const ax = start.longitude;
  const ay = start.latitude;
  const bx = end.longitude;
  const by = end.latitude;
  const px = point.longitude;
  const py = point.latitude;
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const denom = abx * abx + aby * aby;
  if (denom <= 0) {
    return 0;
  }
  const t = (apx * abx + apy * aby) / denom;
  return Math.max(0, Math.min(1, t));
}

function buildFallbackCheckpoints(points: GpxTrackPoint[]): RaceCourse["checkpoints"] {
  const count = Math.min(6, Math.max(2, Math.floor(points.length / 20)));
  if (count <= 2) {
    return [
      {
        id: "aid-1",
        title: "Aid 1",
        latitude: points[0]!.latitude,
        longitude: points[0]!.longitude,
        plannedStopSeconds: DEFAULT_CHECKPOINT_PLANNED_STOP_SECONDS
      },
      {
        id: "aid-2",
        title: "Aid 2",
        latitude: points[points.length - 1]!.latitude,
        longitude: points[points.length - 1]!.longitude,
        plannedStopSeconds: DEFAULT_CHECKPOINT_PLANNED_STOP_SECONDS
      }
    ];
  }

  return Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    const pointIndex = Math.round(ratio * (points.length - 1));
    const point = points[pointIndex]!;
    return {
      id: `aid-${index + 1}`,
      title: `Aid ${index + 1}`,
      latitude: point.latitude,
      longitude: point.longitude,
      plannedStopSeconds: DEFAULT_CHECKPOINT_PLANNED_STOP_SECONDS
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

function uniqueCheckpointId(baseId: string, seen: Set<string>): string {
  if (!seen.has(baseId)) {
    seen.add(baseId);
    return baseId;
  }
  let suffix = 2;
  let candidate = `${baseId}-${suffix}`;
  while (seen.has(candidate)) {
    suffix += 1;
    candidate = `${baseId}-${suffix}`;
  }
  seen.add(candidate);
  return candidate;
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

/** Bucket vertex counts for analytics / pricing instrumentation. */
export function vertexCountBucket(vertexCount: number): string {
  if (vertexCount < 500) {
    return "lt_500";
  }
  if (vertexCount < 2000) {
    return "500_1999";
  }
  return "2000_plus";
}

/** Positive elevation gain along the GPX/KML track when elevations exist on consecutive points. */
export function computeElevationGainMeters(points: GpxTrackPoint[]): number {
  if (points.length < 2) {
    return 0;
  }
  let gainMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]!.elevationMeters;
    const next = points[index]!.elevationMeters;
    if (prev !== null && next !== null && next > prev) {
      gainMeters += next - prev;
    }
  }
  return gainMeters;
}

/** GPX/KML-derived upload stats for `gpx_uploaded` analytics events. */
export function summarizeParsedCourseUploadAnalytics(parsed: ParsedGpxTrack): {
  vertex_count: number;
  vertex_bucket: string;
  waypoint_count: number;
  track_segments: number;
} {
  return {
    vertex_count: parsed.points.length,
    vertex_bucket: vertexCountBucket(parsed.points.length),
    waypoint_count: parsed.waypoints.length,
    track_segments: 1
  };
}

/** Builds a downsampled baseline track suitable for `RaceCourse.baselineTrack`. */
export function buildBaselineTrackFromGpxPoints(points: GpxTrackPoint[]): RaceCourseBaselineTrack | undefined {
  const baselinePoints = buildBaselinePoints(points);
  return baselinePoints.length >= 2 ? { points: baselinePoints } : undefined;
}
