/**
 * Decide when the schedule's attached pacing estimate is stale for the athlete's current history
 * (#487). The estimator already differentiates splits by history, but the mobile client used to
 * compute an estimate only once per room: a cold-start estimate created before any upload locked
 * in, and later GPX uploads never re-fed the estimator. These pure helpers let the schedule screen
 * detect a history change (or a cold-start estimate that now has usable history) and recompute.
 *
 * Loop-safety: after a recompute the estimate id / coldStart flag / recorded fingerprint move to a
 * state that returns `recompute: false`, and a failed attempt records the current fingerprint so it
 * is not retried until the history actually changes again.
 */
import type { ActivityHistoryRef } from "@crewcue/contracts";

/** Rows the micro-model can actually use (mirrors the server `usableHistory` filter). */
export function usableActivityHistory(
  items: readonly ActivityHistoryRef[]
): ActivityHistoryRef[] {
  return items.filter(
    (row) =>
      typeof row.distanceMeters === "number" &&
      row.distanceMeters > 0 &&
      typeof row.elapsedSeconds === "number" &&
      row.elapsedSeconds > 0
  );
}

/**
 * Stable, order-independent fingerprint of the usable history so the schedule can tell when it
 * changed (new upload, Strava sync, edited metrics). Non-usable rows are excluded so a timestamp-
 * less scrap never forces a recompute that the estimator would ignore anyway.
 */
export function usableHistoryFingerprint(items: readonly ActivityHistoryRef[]): string {
  return usableActivityHistory(items)
    .map(
      (row) =>
        `${row.id}:${row.distanceMeters}:${row.elapsedSeconds}:${row.elevationGainMeters ?? ""}`
    )
    .sort()
    .join("|");
}

export type EstimateRecomputeReason = "none" | "cold-start-with-history" | "history-changed";

/** What the schedule screen remembers between focuses (per room). */
export type EstimateHistoryRecord = {
  /** The estimate id the recorded fingerprint belongs to. */
  estimateId: string | undefined;
  /** Usable-history fingerprint captured when we last observed/recomputed that estimate. */
  fingerprint: string | undefined;
};

export const EMPTY_ESTIMATE_HISTORY_RECORD: EstimateHistoryRecord = {
  estimateId: undefined,
  fingerprint: undefined
};

export type EstimateRecomputeInput = {
  /** Only course editors may (re)attach a plan of record. */
  canEdit: boolean;
  /** An estimate create/attach is already in flight. */
  busy: boolean;
  /** The active estimate id (freshly created this session, else the room's attached estimate). */
  estimateId: string | undefined;
  /** coldStart flag of the active estimate. */
  coldStart: boolean | undefined;
  /** Count of usable history rows the athlete currently has. */
  usableHistoryCount: number;
  /** Fingerprint of the athlete's current usable history; `undefined` = not loaded yet. */
  historyFingerprint: string | undefined;
  /** What the screen remembered from the previous observation for this room. */
  record: EstimateHistoryRecord;
};

export type EstimateRecomputeDecision = {
  reason: EstimateRecomputeReason;
  /** Whether the caller should trigger a forced recompute. */
  recompute: boolean;
  /** Record the caller should persist for the next observation. */
  nextRecord: EstimateHistoryRecord;
};

/**
 * Decide whether an already-attached estimate is stale for the athlete's current history.
 * Only meaningful once an estimate exists — the no-estimate bootstrap (auto-create on first view)
 * is handled separately by the schedule screen.
 */
export function decideEstimateRecompute(
  input: EstimateRecomputeInput
): EstimateRecomputeDecision {
  // Not ready to decide: no edit rights, busy, no estimate yet, or history not loaded. Leave the
  // remembered record untouched so we don't adopt a fingerprint before we can act on a change.
  if (
    !input.canEdit ||
    input.busy ||
    input.estimateId === undefined ||
    input.historyFingerprint === undefined
  ) {
    return { reason: "none", recompute: false, nextRecord: input.record };
  }

  const nextRecord: EstimateHistoryRecord = {
    estimateId: input.estimateId,
    fingerprint: input.historyFingerprint
  };

  // Fingerprint we recorded for *this* estimate (undefined if this is a newly seen estimate id).
  const recordedFingerprint =
    input.record.estimateId === input.estimateId ? input.record.fingerprint : undefined;

  // History changed since we computed this estimate (new upload / sync this session) → stale.
  if (
    recordedFingerprint !== undefined &&
    recordedFingerprint !== input.historyFingerprint &&
    input.usableHistoryCount > 0
  ) {
    return { reason: "history-changed", recompute: true, nextRecord };
  }

  // First time we observe this estimate and it is a cold-start plan while the athlete now has
  // usable history (e.g. a cold-start estimate locked in before the upload). Recompute once.
  if (recordedFingerprint === undefined && input.coldStart === true && input.usableHistoryCount > 0) {
    return { reason: "cold-start-with-history", recompute: true, nextRecord };
  }

  // Nothing to do; adopt the current fingerprint for this estimate so future changes are detected.
  return { reason: "none", recompute: false, nextRecord };
}
