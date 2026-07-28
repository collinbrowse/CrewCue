/**
 * Find a checkpoint visit that overlaps a manual-stop time window.
 *
 * Overlap must consider both auto-detected and manual entries. Matching only
 * auto-detected arrivals caused crash/retry (or lease-reclaim) of the same
 * manual stop to append a second visit and double-count stoppage.
 */

export type OverlapVisitCandidate = {
  autoDetected?: {
    arrivalRecordedAt?: string | null;
    departureRecordedAt?: string | null;
  };
  manualEntry?: {
    arrivalAt: string;
    departureAt: string;
  };
};

export function intervalsOverlap(
  startAMs: number,
  endAMs: number,
  startBMs: number,
  endBMs: number
): boolean {
  return startAMs <= endBMs && endAMs >= startBMs;
}

function autoDetectedIntervalMs(
  visit: OverlapVisitCandidate
): { startMs: number; endMs: number } | undefined {
  const arrival = visit.autoDetected?.arrivalRecordedAt;
  if (!arrival) return undefined;
  const startMs = Date.parse(arrival);
  if (!Number.isFinite(startMs)) return undefined;
  const departure = visit.autoDetected?.departureRecordedAt;
  const endMs = departure ? Date.parse(departure) : Number.POSITIVE_INFINITY;
  if (departure && !Number.isFinite(endMs)) return undefined;
  return { startMs, endMs };
}

function manualEntryIntervalMs(
  visit: OverlapVisitCandidate
): { startMs: number; endMs: number } | undefined {
  const entry = visit.manualEntry;
  if (!entry?.arrivalAt || !entry?.departureAt) return undefined;
  const startMs = Date.parse(entry.arrivalAt);
  const endMs = Date.parse(entry.departureAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined;
  return { startMs, endMs };
}

export function findOverlappingCheckpointVisit<T extends OverlapVisitCandidate>(
  visits: readonly T[],
  arrivalMs: number,
  departureMs: number
): T | undefined {
  return visits.find((visit) => {
    const auto = autoDetectedIntervalMs(visit);
    if (auto && intervalsOverlap(auto.startMs, auto.endMs, arrivalMs, departureMs)) {
      return true;
    }
    const manual = manualEntryIntervalMs(visit);
    if (manual && intervalsOverlap(manual.startMs, manual.endMs, arrivalMs, departureMs)) {
      return true;
    }
    return false;
  });
}
