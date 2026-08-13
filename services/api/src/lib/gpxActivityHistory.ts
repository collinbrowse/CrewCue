/**
 * Parse athlete activity GPX into metrics for ActivityHistoryRef (W3-1).
 * Reuses map-core track parsing; maps clear errors for empty/corrupt uploads.
 */
import { createHash } from "node:crypto";
import { computeElevationGainMeters, parseGpxTrack } from "@crewcue/map-core";

export type GpxActivityParseErrorCode = "gpx_empty" | "gpx_corrupt" | "gpx_parse_failed";

export class GpxActivityParseError extends Error {
  readonly code: GpxActivityParseErrorCode;

  constructor(code: GpxActivityParseErrorCode, message: string) {
    super(message);
    this.name = "GpxActivityParseError";
    this.code = code;
  }
}

export type ParsedGpxActivityMetrics = {
  /** Activity start clock when track timestamps exist; otherwise omitted (caller uses ingestedAt). */
  recordedAt?: string;
  distanceMeters: number;
  /** Present only when the GPX includes usable point timestamps. */
  elapsedSeconds?: number;
  /** Present only when the GPX includes elevation samples. */
  elevationGainMeters?: number;
};

function toIsoZ(ms: number): string {
  return new Date(ms).toISOString();
}

/** Stable fingerprint for idempotent gpx_upload when caller omits externalId. */
export function fingerprintGpxExternalId(gpxXml: string): string {
  return createHash("sha256").update(gpxXml).digest("hex").slice(0, 32);
}

function classifyParseFailure(err: unknown): GpxActivityParseError {
  const message = err instanceof Error ? err.message : "GPX parse failed";
  if (/empty|at least two track points|distance is zero/i.test(message)) {
    return new GpxActivityParseError("gpx_empty", message);
  }
  if (/invalid|unexpected|malformed|corrupt|not well-formed/i.test(message)) {
    return new GpxActivityParseError("gpx_corrupt", message);
  }
  // Unclosed tags / extract failures often surface as generic Error from the XML walker.
  if (/GPX must|Unsupported|Export a valid/i.test(message)) {
    return new GpxActivityParseError("gpx_parse_failed", message);
  }
  return new GpxActivityParseError("gpx_corrupt", message);
}

/**
 * Parse GPX XML into activity metrics (meters + seconds).
 * @throws {GpxActivityParseError} for empty track / corrupt / unusable GPX
 */
export function parseGpxActivityMetrics(gpxXml: string): ParsedGpxActivityMetrics {
  const trimmed = gpxXml.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    throw new GpxActivityParseError("gpx_empty", "GPX file is empty. Export a valid GPX track and try again.");
  }

  let parsed;
  try {
    parsed = parseGpxTrack(trimmed);
  } catch (err) {
    throw classifyParseFailure(err);
  }

  const hasTimestamps =
    parsed.points.filter((point) => point.timestampMs !== null).length >= 2 &&
    parsed.startTimestampMs > 0;

  const hasElevation = parsed.points.some((point) => point.elevationMeters !== null);
  const elevationGainMeters = hasElevation ? computeElevationGainMeters(parsed.points) : undefined;

  const metrics: ParsedGpxActivityMetrics = {
    distanceMeters: parsed.totalDistanceMeters
  };

  if (hasTimestamps) {
    metrics.recordedAt = toIsoZ(parsed.startTimestampMs);
    metrics.elapsedSeconds = parsed.totalDurationSeconds;
  }

  if (elevationGainMeters !== undefined) {
    metrics.elevationGainMeters = elevationGainMeters;
  }

  return metrics;
}
