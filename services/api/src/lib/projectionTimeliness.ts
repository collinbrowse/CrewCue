import type { ProjectionConfidence, RaceRoomProjection, RaceRoomProjectionCore } from "@crewcue/contracts";

/** Multiplier from client-declared ping interval → staleness threshold (see docs). */
export const STALENESS_INTERVAL_MULTIPLIER = 2.5;
export const STALENESS_DERIVED_MIN_SECONDS = 45;
export const STALENESS_DERIVED_MAX_SECONDS = 600;

const DEFAULT_STALE_AFTER_SECONDS = 120;

function readEnvFallbackSeconds(): number {
  const raw = process.env.PROJECTION_STALE_AFTER_SECONDS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_STALE_AFTER_SECONDS;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_STALE_AFTER_SECONDS;
  }
  return Math.floor(n);
}

/**
 * Effective staleness threshold: when the athlete app declares `uploadIntervalSeconds`,
 * use `clamp(round(multiplier × interval), min, max)` so the UI tolerates jitter without
 * lying about “fresh” after a long outage. Otherwise use `PROJECTION_STALE_AFTER_SECONDS` (default 120).
 */
export function getStalenessThresholdSeconds(lastDeclaredUploadIntervalSeconds?: number): number {
  if (
    lastDeclaredUploadIntervalSeconds !== undefined &&
    Number.isFinite(lastDeclaredUploadIntervalSeconds) &&
    lastDeclaredUploadIntervalSeconds > 0
  ) {
    const derived = Math.round(STALENESS_INTERVAL_MULTIPLIER * lastDeclaredUploadIntervalSeconds);
    return Math.min(
      STALENESS_DERIVED_MAX_SECONDS,
      Math.max(STALENESS_DERIVED_MIN_SECONDS, derived)
    );
  }
  return readEnvFallbackSeconds();
}

/**
 * Adds Task 3 timeliness fields. `lastAcceptedRecordedAtMs` is the client `recordedAt` of the latest
 * accepted ping (same basis as implausible-motion checks).
 */
export function attachProjectionTimeliness(
  core: RaceRoomProjectionCore,
  lastAcceptedRecordedAtMs: number | null,
  evaluatedAtMs: number,
  lastDeclaredUploadIntervalSeconds?: number
): RaceRoomProjection {
  const stalenessThresholdSeconds = getStalenessThresholdSeconds(lastDeclaredUploadIntervalSeconds);

  if (lastAcceptedRecordedAtMs === null || Number.isNaN(lastAcceptedRecordedAtMs)) {
    const evaluatedAt = new Date(evaluatedAtMs).toISOString();
    return {
      ...core,
      projectionConfidence: "degraded",
      stalenessThresholdSeconds,
      secondsSinceLastAcceptedPing: stalenessThresholdSeconds,
      evaluatedAt
    };
  }

  const secondsSinceLastAcceptedPing = Math.max(0, (evaluatedAtMs - lastAcceptedRecordedAtMs) / 1000);
  const projectionConfidence: ProjectionConfidence =
    secondsSinceLastAcceptedPing > stalenessThresholdSeconds ? "degraded" : "fresh";

  return {
    ...core,
    projectionConfidence,
    stalenessThresholdSeconds,
    secondsSinceLastAcceptedPing,
    evaluatedAt: new Date(evaluatedAtMs).toISOString()
  };
}
