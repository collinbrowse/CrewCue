import type { ProjectionConfidence, RaceRoomProjection, RaceRoomProjectionCore } from "@crewcue/contracts";

const DEFAULT_STALE_AFTER_SECONDS = 120;

export function getStalenessThresholdSeconds(): number {
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
 * Adds Task 3 timeliness fields. `lastAcceptedRecordedAtMs` is the client `recordedAt` of the latest
 * accepted ping (same basis as implausible-motion checks).
 */
export function attachProjectionTimeliness(
  core: RaceRoomProjectionCore,
  lastAcceptedRecordedAtMs: number | null,
  evaluatedAtMs: number
): RaceRoomProjection {
  const stalenessThresholdSeconds = getStalenessThresholdSeconds();
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
