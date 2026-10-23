/**
 * Cutoff warnings for crew schedule projection (W4-1 / #408).
 *
 * Does not change moving-time math — only compares an already-projected arrival
 * to `RaceCourseCheckpoint.cutoff`.
 *
 * ## time_of_day policy (UTC race-day wall clock)
 *
 * Resolve `{ hour, minute }` against the **UTC calendar date** of `raceStartAt`:
 * `YYYY-MM-DD` from `raceStartAt` + `HH:MM:00.000Z`. No local timezone is applied.
 * This keeps CI fixtures deterministic; do not invent a venue TZ without a fixture.
 *
 * ## Status bands
 *
 * - `ok`: marginSeconds > CUTOFF_WARN_MARGIN_SECONDS (comfortably early)
 * - `warn`: 0 < marginSeconds ≤ CUTOFF_WARN_MARGIN_SECONDS
 * - `breach`: marginSeconds ≤ 0 (at or after cutoff)
 *
 * `marginSeconds` = cutoffInstant − projectedArrival (seconds; negative when over).
 */
import {
  CUTOFF_WARN_MARGIN_SECONDS,
  type CutoffWarningStatus,
  type RaceCourseCheckpointCutoff
} from "@crewcue/contracts";

export { CUTOFF_WARN_MARGIN_SECONDS };

export type CutoffWarning = {
  cutoffStatus: CutoffWarningStatus;
  cutoffMarginSeconds: number;
};

/**
 * Absolute cutoff instant (ms since epoch) for comparison, or `undefined` when absent.
 */
export function cutoffInstantMs(
  cutoff: RaceCourseCheckpointCutoff | undefined,
  raceStartAtMs: number
): number | undefined {
  if (!cutoff || !Number.isFinite(raceStartAtMs)) {
    return undefined;
  }
  if (cutoff.mode === "elapsed_from_start") {
    return raceStartAtMs + cutoff.seconds * 1000;
  }
  // time_of_day: UTC race-day wall clock (same UTC calendar date as raceStartAt).
  const raceDay = new Date(raceStartAtMs);
  const y = raceDay.getUTCFullYear();
  const m = raceDay.getUTCMonth();
  const d = raceDay.getUTCDate();
  return Date.UTC(y, m, d, cutoff.hour, cutoff.minute, 0, 0);
}

export function classifyCutoffMargin(
  marginSeconds: number,
  warnMarginSeconds: number = CUTOFF_WARN_MARGIN_SECONDS
): CutoffWarningStatus {
  if (marginSeconds <= 0) {
    return "breach";
  }
  if (marginSeconds <= warnMarginSeconds) {
    return "warn";
  }
  return "ok";
}

/**
 * Compare projected arrival to checkpoint cutoff.
 * @returns warning fields, or `undefined` when cutoff is absent (omit from ScheduleStop).
 */
export function compareProjectedArrivalToCutoff(input: {
  cutoff: RaceCourseCheckpointCutoff | undefined;
  raceStartAtMs: number;
  /** Projected clock arrival ms (ISO-Z parsed). */
  clockArrivalAtMs: number;
  /** Optional override for tests; default CUTOFF_WARN_MARGIN_SECONDS. */
  warnMarginSeconds?: number;
}): CutoffWarning | undefined {
  const cutoffAtMs = cutoffInstantMs(input.cutoff, input.raceStartAtMs);
  if (cutoffAtMs === undefined) {
    return undefined;
  }
  if (!Number.isFinite(input.clockArrivalAtMs)) {
    return undefined;
  }
  const marginSeconds = Math.round((cutoffAtMs - input.clockArrivalAtMs) / 1000);
  return {
    cutoffStatus: classifyCutoffMargin(marginSeconds, input.warnMarginSeconds),
    cutoffMarginSeconds: marginSeconds
  };
}
