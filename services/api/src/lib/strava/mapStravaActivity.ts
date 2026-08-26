/**
 * Map Strava activity summary payloads → ActivityHistoryRef (W3-2).
 */
import { randomUUID } from "node:crypto";
import { parseActivityHistoryRef, type ActivityHistoryRef } from "@crewcue/contracts";

export type StravaActivitySummary = {
  id: number | string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  start_date?: string;
  external_id?: string;
  /** Legacy Strava activity type (e.g. Run, Ride). */
  type?: string;
  /** Current Strava sport_type (e.g. TrailRun, MountainBikeRide). */
  sport_type?: string;
};

/**
 * Sport labels the pacing estimator can treat as running history.
 * Rides/swims of similar distance would otherwise be selected as "similar"
 * activities and pull crew ETAs hours early.
 */
const STRAVA_RUN_LIKE_TYPES = new Set(["run", "trailrun", "virtualrun"]);

function normalizeSportLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * True when the summary is run-like, or when Strava omitted type fields
 * (incomplete payloads / older fixtures). Non-run sports must be skipped.
 */
export function isStravaRunLikeActivity(summary: StravaActivitySummary): boolean {
  const labels = [summary.sport_type, summary.type].map(normalizeSportLabel).filter((label) => label.length > 0);
  if (labels.length === 0) {
    return true;
  }
  return labels.some((label) => STRAVA_RUN_LIKE_TYPES.has(label));
}

function requireFiniteNonNegative(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative finite number when present`);
  }
  return value;
}

function toIsoZ(value: string, field: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new TypeError(`${field} must be a parseable timestamp`);
  }
  return new Date(ms).toISOString();
}

/** Stable external id for idempotent upserts. */
export function stravaExternalId(activityId: number | string): string {
  const raw = String(activityId).trim();
  if (!raw) {
    throw new TypeError("Strava activity id is required");
  }
  if (raw.startsWith("strava:")) {
    return raw;
  }
  return `strava:${raw}`;
}

/**
 * Convert a Strava activity summary (API list item or fixture) into a stored history ref.
 */
export function mapStravaActivityToHistoryRef(
  summary: StravaActivitySummary,
  options?: { ingestedAt?: string; historyId?: string }
): ActivityHistoryRef {
  if (summary.id === undefined || summary.id === null || String(summary.id).trim() === "") {
    throw new TypeError("Strava activity id is required");
  }
  if (!isStravaRunLikeActivity(summary)) {
    throw new TypeError("Strava activity is not a run-like sport");
  }

  const ingestedAt = options?.ingestedAt ?? new Date().toISOString();
  const recordedAt = summary.start_date
    ? toIsoZ(summary.start_date, "start_date")
    : ingestedAt;

  const distanceMeters = requireFiniteNonNegative(summary.distance, "distance");
  const elapsedRaw =
    summary.elapsed_time !== undefined ? summary.elapsed_time : summary.moving_time;
  const elapsedSeconds = requireFiniteNonNegative(elapsedRaw, "elapsed_time");
  const elevationGainMeters = requireFiniteNonNegative(
    summary.total_elevation_gain,
    "total_elevation_gain"
  );

  const candidate: ActivityHistoryRef = {
    id: options?.historyId ?? randomUUID(),
    source: "strava",
    externalId: stravaExternalId(summary.id),
    recordedAt,
    ingestedAt,
    ...(distanceMeters !== undefined ? { distanceMeters } : {}),
    ...(elapsedSeconds !== undefined ? { elapsedSeconds } : {}),
    ...(elevationGainMeters !== undefined ? { elevationGainMeters } : {})
  };

  return parseActivityHistoryRef(candidate);
}
