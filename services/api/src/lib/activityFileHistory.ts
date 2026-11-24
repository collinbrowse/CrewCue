/**
 * Exported activity files (GPX, FIT, TCX) → pacing-history metrics (#652).
 * Parsing lives in map-core; this adds the history source, a content fingerprint and slowdown.
 */
import { createHash } from "node:crypto";
import type { ActivityHistorySource } from "@crewcue/contracts";
import {
  ActivityFileError,
  buildActivityGradeProfile,
  isFootActivity,
  parseActivityFile,
  type ActivityFileFormat
} from "@crewcue/map-core";
import type { ParsedGpxActivityMetrics } from "./gpxActivityHistory.js";
import { slowdownFromTimedTrack } from "./runnerSlowdown.js";

export { ActivityFileError, MAX_ACTIVITY_FILE_BYTES } from "@crewcue/map-core";

const SPORT_NAMES: Record<string, string> = { cycling: "a ride", other: "not a run or hike" };

export const ACTIVITY_FILE_SOURCES: Record<ActivityFileFormat, ActivityHistorySource> = {
  gpx: "gpx_upload",
  fit: "fit_upload",
  tcx: "tcx_upload"
};

export type ParsedActivityFileMetrics = ParsedGpxActivityMetrics & { source: ActivityHistorySource };

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
    distanceMeters: parsed.distanceMeters
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
