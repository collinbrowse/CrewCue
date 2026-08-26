/**
 * Helpers for athlete activity GPX upload → shared ActivityHistoryRef store.
 * Parse on-device so we POST small metrics (staging rejects ~1MB+ JSON GPX bodies).
 */
import { computeElevationGainMeters, parseGpxTrack } from "@crewcue/map-core";

export type ActivityGpxFileInput = {
  fileName: string;
  gpxXml: string;
};

export type ActivityGpxUploadFileResult =
  | { fileName: string; ok: true; historyId: string; created: boolean }
  | { fileName: string; ok: false; message: string };

export type ActivityGpxUploadBatchSummary = {
  uploadedCount: number;
  failedCount: number;
  message: string;
  results: ActivityGpxUploadFileResult[];
};

/** In-flight stage shown on Profile while a GPX batch runs. */
export type ActivityGpxUploadProgressStage =
  | "picking"
  | "reading"
  | "parsing"
  | "uploading"
  | "refreshing";

export type ActivityGpxUploadProgress = {
  stage: ActivityGpxUploadProgressStage;
  /** 1-based index when working a file in a multi-select batch. */
  fileIndex?: number;
  fileCount?: number;
  fileName?: string;
};

const FILE_STAGE_ORDER: ActivityGpxUploadProgressStage[] = ["reading", "parsing", "uploading"];

/**
 * Determinate 0..1 progress for the upload bar.
 * Spreads work across files; within each file: reading → parsing → uploading.
 */
export function activityUploadProgressRatio(progress: ActivityGpxUploadProgress): number {
  const { stage, fileIndex, fileCount } = progress;
  if (stage === "picking") return 0.02;
  if (stage === "refreshing") return 0.96;

  const count = typeof fileCount === "number" && fileCount > 0 ? fileCount : 1;
  const index =
    typeof fileIndex === "number" && fileIndex >= 1 ? Math.min(fileIndex, count) : 1;
  const stageIdx = FILE_STAGE_ORDER.indexOf(stage);
  const withinFile = stageIdx >= 0 ? stageIdx / FILE_STAGE_ORDER.length : 0;
  const raw = ((index - 1) + withinFile) / count;
  // Keep bar between picking and refreshing.
  return Math.min(0.94, Math.max(0.04, 0.04 + raw * 0.9));
}

/** Human-readable status line for an in-progress upload (never empty). */
export function formatActivityUploadProgress(progress: ActivityGpxUploadProgress): string {
  const { stage, fileName, fileIndex, fileCount } = progress;
  const hasBatch =
    typeof fileIndex === "number" &&
    typeof fileCount === "number" &&
    fileCount > 0 &&
    fileIndex >= 1;
  const filePart = fileName ? ` “${fileName}”` : "";
  const batchPart = hasBatch ? ` (${fileIndex} of ${fileCount})` : "";

  switch (stage) {
    case "picking":
      return "Waiting for file selection…";
    case "reading":
      return `Reading${filePart}${batchPart}…`;
    case "parsing":
      return `Parsing GPX${filePart}${batchPart}…`;
    case "uploading":
      return `Sending metrics${filePart}${batchPart}…`;
    case "refreshing":
      return "Refreshing activity history…";
    default:
      return "Working…";
  }
}

/** Metrics payload for `POST /activity-history` (server fills id / ingestedAt / source). */
export type ActivityHistoryMetricsIngest = {
  externalId: string;
  recordedAt?: string;
  distanceMeters: number;
  elapsedSeconds?: number;
  elevationGainMeters?: number;
};

export type ParsedActivityGpxMetrics = Omit<ActivityHistoryMetricsIngest, "externalId">;

export class ActivityGpxParseError extends Error {
  readonly code: "gpx_empty" | "gpx_corrupt" | "gpx_parse_failed";

  constructor(code: ActivityGpxParseError["code"], message: string) {
    super(message);
    this.name = "ActivityGpxParseError";
    this.code = code;
  }
}

/** Build a short status line after a multi-file upload attempt. */
export function summarizeActivityGpxUploadBatch(
  results: ActivityGpxUploadFileResult[]
): ActivityGpxUploadBatchSummary {
  const uploadedCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - uploadedCount;
  const parts: string[] = [];
  if (uploadedCount > 0) {
    parts.push(
      `Uploaded ${uploadedCount} activit${uploadedCount === 1 ? "y" : "ies"}`
    );
  }
  if (failedCount > 0) {
    const firstFail = results.find((r) => !r.ok);
    parts.push(
      failedCount === 1 && firstFail && !firstFail.ok
        ? `${firstFail.fileName}: ${firstFail.message}`
        : `${failedCount} failed`
    );
  }
  if (parts.length === 0) {
    parts.push("No files uploaded");
  }
  return {
    uploadedCount,
    failedCount,
    message: parts.join(" · "),
    results
  };
}

/** True when XML looks like a GPX document (lightweight client-side guard). */
export function looksLikeGpxXml(contents: string): boolean {
  return /<gpx[\s>]/i.test(contents.trim());
}

function toIsoZ(ms: number): string {
  return new Date(ms).toISOString();
}

function classifyParseFailure(err: unknown): ActivityGpxParseError {
  const message = err instanceof Error ? err.message : "GPX parse failed";
  if (/empty|at least two track points|distance is zero/i.test(message)) {
    return new ActivityGpxParseError("gpx_empty", message);
  }
  if (/invalid|unexpected|malformed|corrupt|not well-formed/i.test(message)) {
    return new ActivityGpxParseError("gpx_corrupt", message);
  }
  if (/GPX must|Unsupported|Export a valid/i.test(message)) {
    return new ActivityGpxParseError("gpx_parse_failed", message);
  }
  return new ActivityGpxParseError("gpx_corrupt", message);
}

/**
 * Parse activity GPX into metrics (no network). Caller adds `externalId` via fingerprint.
 */
export function parseActivityGpxMetrics(gpxXml: string): ParsedActivityGpxMetrics {
  const trimmed = gpxXml.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    throw new ActivityGpxParseError(
      "gpx_empty",
      "GPX file is empty. Export a valid GPX track and try again."
    );
  }
  if (!looksLikeGpxXml(trimmed)) {
    throw new ActivityGpxParseError(
      "gpx_parse_failed",
      "Not a GPX file. Export a GPX track with timestamps and try again."
    );
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

  const metrics: ParsedActivityGpxMetrics = {
    distanceMeters: parsed.totalDistanceMeters
  };

  if (hasTimestamps) {
    metrics.recordedAt = toIsoZ(parsed.startTimestampMs);
    metrics.elapsedSeconds = parsed.totalDurationSeconds;
  }
  if (elevationGainMeters !== undefined) {
    metrics.elevationGainMeters = elevationGainMeters;
  }

  if (!(typeof metrics.elapsedSeconds === "number" && metrics.elapsedSeconds > 0)) {
    throw new ActivityGpxParseError(
      "gpx_parse_failed",
      "GPX needs track timestamps so we can use pace for predictions. Re-export with times and try again."
    );
  }

  return metrics;
}

/** Friendlier copy when React Native fetch fails before an HTTP response. */
export function formatActivityUploadNetworkError(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  if (!/network request failed/i.test(err.message)) return undefined;
  return "Upload could not reach the API. Check your connection, or try a smaller GPX export.";
}
