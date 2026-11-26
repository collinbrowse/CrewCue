/**
 * Exported activity files (GPX, FIT, TCX) → pacing-history metrics (#652).
 * Parsing lives in map-core; this adds the history source, a content fingerprint and slowdown.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { ActivityHistorySource } from "@crewcue/contracts";
import {
  ActivityFileError,
  buildActivityGradeProfile,
  isFootActivity,
  MAX_ACTIVITY_FILE_BYTES,
  parseActivityFile,
  type ActivityFileFormat
} from "@crewcue/map-core";
import type { ParsedGpxActivityMetrics } from "./gpxActivityHistory.js";
import { slowdownFromTimedTrack } from "./runnerSlowdown.js";

export { ActivityFileError, MAX_ACTIVITY_FILE_BYTES } from "@crewcue/map-core";

const SPORT_NAMES: Record<string, string> = { cycling: "a ride", walking: "a walk", other: "not a run or hike" };

export const ACTIVITY_FILE_SOURCES: Record<ActivityFileFormat, ActivityHistorySource> = {
  gpx: "gpx_upload",
  fit: "fit_upload",
  tcx: "tcx_upload"
};

export type ParsedActivityFileMetrics = ParsedGpxActivityMetrics & {
  source: ActivityHistorySource;
  /** The activity's title from the file, when it has one. */
  name?: string;
};

export function looksLikeGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08;
}

/**
 * A gzipped activity file (`.fit.gz`) → the file inside and its name without `.gz`. Strava's bulk
 * export keeps each original FIT and TCX upload gzipped this way; only its own GPX files are plain.
 * Other bytes come back unchanged.
 * @throws {ActivityFileError} for a corrupt gzip or one that unpacks past the 10 MB file limit
 */
export function gunzipActivityFile(bytes: Uint8Array, fileName: string): { bytes: Uint8Array; fileName: string } {
  if (!looksLikeGzip(bytes)) return { bytes, fileName };
  let inflated: Buffer;
  try {
    inflated = gunzipSync(bytes, { maxOutputLength: MAX_ACTIVITY_FILE_BYTES + 1 });
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
      throw new ActivityFileError("file_too_large", "The file is larger than 10 MB. Export a single activity.");
    }
    throw new ActivityFileError("file_corrupt", "Couldn't read this file. Export it again and retry.");
  }
  if (inflated.length > MAX_ACTIVITY_FILE_BYTES) {
    throw new ActivityFileError("file_too_large", "The file is larger than 10 MB. Export a single activity.");
  }
  return { bytes: new Uint8Array(inflated), fileName: fileName.replace(/\.gz$/i, "") };
}

/** Stable id so importing the same file twice returns the stored row. */
export function fingerprintActivityFile(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

/** @throws {ActivityFileError} */
export function parseActivityFileMetrics(bytes: Uint8Array, fileName?: string): ParsedActivityFileMetrics {
  const parsed = parseActivityFile(bytes, fileName);
  // Pacing history is runs and hikes. A bulk export also holds rides, swims and gym sessions.
  if (!isFootActivity(parsed.sport)) {
    const what = SPORT_NAMES[parsed.sport ?? "other"] ?? "not a run or hike";
    throw new ActivityFileError("file_unsupported", `This activity is ${what}. Choose a run or hike.`);
  }
  const metrics: ParsedActivityFileMetrics = {
    source: ACTIVITY_FILE_SOURCES[parsed.format],
    distanceMeters: parsed.distanceMeters,
    ...(parsed.name ? { name: parsed.name } : {})
  };
  if (parsed.startTimestampMs !== null && parsed.startTimestampMs > 0) {
    metrics.recordedAt = new Date(parsed.startTimestampMs).toISOString();
  }
  if (parsed.elapsedSeconds !== null) {
    metrics.elapsedSeconds = parsed.elapsedSeconds;
    const slope = parsed.points.length >= 2 ? slowdownFromTimedTrack(parsed.points) : null;
    if (slope !== null) {
      metrics.slowdownSlope = Number(slope.toFixed(4));
    }
    const gradeProfile = buildActivityGradeProfile(parsed.points);
    if (gradeProfile) {
      metrics.gradeProfile = gradeProfile;
    }
  }
  if (parsed.elevationGainMeters !== null) {
    metrics.elevationGainMeters = parsed.elevationGainMeters;
  }
  return metrics;
}
