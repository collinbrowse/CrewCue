import type { CrewScheduleSheet, ScheduleStop } from "@crewcue/contracts";
import { formatEtaClock, formatRemainingMinutes } from "../readouts/eta";
import { formatDurationSeconds, formatScheduleClock } from "../schedule/formatSchedule";

export type MapSheetPhase = "preStart" | "race" | "finish";

export type CourseCheckpointRef = {
  id: string;
  title?: string;
  distanceMetersFromStart?: number;
  plannedStopSeconds?: number;
};

export type SplitRef = {
  checkpointId: string;
  distanceMetersFromStart: number;
  crossedAtRecordedAt: string | null;
  plannedStopSeconds?: number;
};

export type AidStationPage = {
  checkpointId: string;
  title: string;
  /** 0-based pager index. */
  index: number;
  stop?: ScheduleStop;
  distanceMetersFromStart?: number;
  plannedStoppageSeconds?: number;
};

export type LiveNextCheckpoint = {
  checkpointId: string;
  distanceMetersFromStart: number;
  crossedAtRecordedAt: string | null;
};

export type PeekArrival = {
  clockLabel: string;
  remainLabel: string;
  source: "schedule" | "projection" | "none";
};

export type PeekStationStats = {
  distanceLabel: string;
  stoppageLabel: string;
  delayLabel?: string;
};

export type ProjectionEtaFallback = {
  etaMs: number;
  remainSeconds: number;
};

const METERS_PER_MILE = 1609.344;

export function clampIndex(index: number, pageCount: number): number {
  if (pageCount <= 0) {
    return 0;
  }
  if (!Number.isFinite(index)) {
    return 0;
  }
  return Math.max(0, Math.min(pageCount - 1, Math.trunc(index)));
}

export function indexForCheckpointId(pages: readonly AidStationPage[], checkpointId: string): number | null {
  const i = pages.findIndex((p) => p.checkpointId === checkpointId);
  return i >= 0 ? i : null;
}

/**
 * Pager pages: schedule stops when present (plan of record), else course checkpoints.
 */
export function buildAidStationPages(args: {
  sheet?: CrewScheduleSheet | null;
  checkpoints?: readonly CourseCheckpointRef[];
  titleByCheckpointId?: ReadonlyMap<string, string>;
  checkpointDistanceById?: ReadonlyMap<string, number>;
}): AidStationPage[] {
  const titles = args.titleByCheckpointId ?? new Map<string, string>();
  const distances = args.checkpointDistanceById ?? new Map<string, number>();
  const stops = args.sheet?.stops ?? [];
  if (stops.length > 0) {
    return stops.map((stop, index) => {
      const fromCourse = distances.get(stop.checkpointId);
      return {
        checkpointId: stop.checkpointId,
        title: titles.get(stop.checkpointId) ?? stop.checkpointId,
        index,
        stop,
        distanceMetersFromStart:
          typeof fromCourse === "number" && Number.isFinite(fromCourse) ? fromCourse : undefined,
        plannedStoppageSeconds: stop.plannedStoppageSeconds
      };
    });
  }
  const cps = args.checkpoints ?? [];
  return cps.map((cp, index) => {
    const fromCourse = distances.get(cp.id);
    const distance =
      typeof fromCourse === "number" && Number.isFinite(fromCourse)
        ? fromCourse
        : typeof cp.distanceMetersFromStart === "number" && Number.isFinite(cp.distanceMetersFromStart)
          ? cp.distanceMetersFromStart
          : undefined;
    const stoppage =
      typeof cp.plannedStopSeconds === "number" && Number.isFinite(cp.plannedStopSeconds)
        ? cp.plannedStopSeconds
        : undefined;
    return {
      checkpointId: cp.id,
      title: titles.get(cp.id) ?? cp.title ?? cp.id,
      index,
      distanceMetersFromStart: distance,
      plannedStoppageSeconds: stoppage
    };
  });
}

/**
 * Next unmet aid along the course: prefer uncrossed split rows, else infer from distances + progress.
 */
export function resolveLiveNextCheckpoint(
  checkpoints: readonly CourseCheckpointRef[] | undefined,
  splits: readonly SplitRef[] | undefined,
  progressMeters: number,
  checkpointDistanceById: ReadonlyMap<string, number>
): LiveNextCheckpoint | null {
  const cps = checkpoints ?? [];
  if (cps.length === 0) {
    return null;
  }
  const rows = splits ?? [];
  if (rows.length > 0) {
    const row = rows.find((r) => r.crossedAtRecordedAt === null) ?? rows[rows.length - 1];
    if (!row) {
      return null;
    }
    const fromCourse = checkpointDistanceById.get(row.checkpointId);
    const distanceMetersFromStart =
      typeof fromCourse === "number" && Number.isFinite(fromCourse) ? fromCourse : row.distanceMetersFromStart;
    return {
      checkpointId: row.checkpointId,
      distanceMetersFromStart,
      crossedAtRecordedAt: row.crossedAtRecordedAt
    };
  }
  const progress = Number.isFinite(progressMeters) ? progressMeters : 0;
  for (const cp of cps) {
    const d = checkpointDistanceById.get(cp.id);
    if (d === undefined || !Number.isFinite(d)) {
      continue;
    }
    if (d > progress + 5) {
      return { checkpointId: cp.id, distanceMetersFromStart: d, crossedAtRecordedAt: null };
    }
  }
  const lastCp = cps[cps.length - 1]!;
  const lastD = checkpointDistanceById.get(lastCp.id) ?? progress;
  return { checkpointId: lastCp.id, distanceMetersFromStart: lastD, crossedAtRecordedAt: null };
}

export function liveNextIndex(
  pages: readonly AidStationPage[],
  live: { checkpointId: string } | null
): number | null {
  if (!live || pages.length === 0) {
    return null;
  }
  return indexForCheckpointId(pages, live.checkpointId);
}

export function defaultIndexForPhase(
  phase: MapSheetPhase,
  pageCount: number,
  liveNext: number | null
): number {
  if (pageCount <= 0) {
    return 0;
  }
  if (phase === "preStart") {
    return 0;
  }
  if (phase === "finish") {
    return pageCount - 1;
  }
  return clampIndex(liveNext ?? 0, pageCount);
}

/** User paging: follow only when they land on the live next (or jump/follow sources). */
export function followAfterUserPage(landedIndex: number, liveNext: number | null): boolean {
  if (liveNext == null || !Number.isFinite(landedIndex)) {
    return false;
  }
  return landedIndex === liveNext;
}

export function nextIndexIfFollow(
  follow: boolean,
  liveNext: number | null,
  currentIndex: number,
  pageCount: number
): number {
  const clamped = clampIndex(currentIndex, pageCount);
  if (!follow || liveNext == null) {
    return clamped;
  }
  return clampIndex(liveNext, pageCount);
}

/**
 * Peek kicker. START/FINISHED win on phase endpoints; otherwise NEXT for live next; else AID n.
 */
export function peekKicker(args: {
  phase: MapSheetPhase;
  pageIndex: number;
  pageCount: number;
  liveNextIndex: number | null;
}): string {
  const { phase, pageIndex, pageCount, liveNextIndex } = args;
  if (pageCount <= 0) {
    return "AID";
  }
  if (phase === "preStart" && pageIndex === 0) {
    return "START";
  }
  if (phase === "finish" && pageIndex === pageCount - 1) {
    return "FINISHED";
  }
  if (liveNextIndex != null && pageIndex === liveNextIndex) {
    return "NEXT";
  }
  return `AID ${pageIndex + 1}`;
}

export function remainLabelFromSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return "—";
  }
  if (seconds <= 0) {
    return "DONE";
  }
  if (seconds < 60) {
    return "< 1 min";
  }
  return formatRemainingMinutes(seconds);
}

/**
 * Prefer API `clockArrivalAt`. Projection ETA is fallback only until schedule loads.
 * Does not recompute arrival from elapsed + raceStartAt.
 */
export function peekArrival(args: {
  stop?: ScheduleStop;
  nowMs: number;
  fallback?: ProjectionEtaFallback;
}): PeekArrival {
  const iso = args.stop?.clockArrivalAt;
  if (typeof iso === "string" && iso.length > 0) {
    const arrivalMs = Date.parse(iso);
    if (!Number.isNaN(arrivalMs)) {
      const remainSeconds = (arrivalMs - args.nowMs) / 1000;
      return {
        clockLabel: formatScheduleClock(iso),
        remainLabel: remainLabelFromSeconds(remainSeconds),
        source: "schedule"
      };
    }
  }
  if (args.fallback && Number.isFinite(args.fallback.etaMs) && args.fallback.etaMs > 0) {
    return {
      clockLabel: formatEtaClock(args.fallback.etaMs),
      remainLabel: remainLabelFromSeconds(args.fallback.remainSeconds),
      source: "projection"
    };
  }
  return { clockLabel: "—", remainLabel: "—", source: "none" };
}

export function peekStationStats(args: {
  progressMeters: number;
  distanceMetersFromStart?: number;
  plannedStoppageSeconds?: number;
  delayOverrideSeconds?: number;
}): PeekStationStats {
  let distanceLabel = "—";
  if (typeof args.distanceMetersFromStart === "number" && Number.isFinite(args.distanceMetersFromStart)) {
    const remainM = Math.max(0, args.distanceMetersFromStart - (Number.isFinite(args.progressMeters) ? args.progressMeters : 0));
    distanceLabel = `${(remainM / METERS_PER_MILE).toFixed(1)} MI`;
  }
  let stoppageLabel = "—";
  if (typeof args.plannedStoppageSeconds === "number" && Number.isFinite(args.plannedStoppageSeconds)) {
    stoppageLabel = `${Math.round(args.plannedStoppageSeconds / 60)}m`;
  }
  const delayLabel =
    typeof args.delayOverrideSeconds === "number" && Number.isFinite(args.delayOverrideSeconds)
      ? formatDurationSeconds(args.delayOverrideSeconds)
      : undefined;
  return { distanceLabel, stoppageLabel, delayLabel };
}

export function projectionEtaFallbackForPage(args: {
  distanceMetersFromStart?: number;
  progressMeters: number;
  paceSecondsPerKm?: number;
  nowMs: number;
}): ProjectionEtaFallback | undefined {
  const dist = args.distanceMetersFromStart;
  const pace = args.paceSecondsPerKm;
  if (typeof dist !== "number" || !Number.isFinite(dist) || typeof pace !== "number" || !Number.isFinite(pace) || pace <= 0) {
    return undefined;
  }
  const distTo = Math.max(0, dist - (Number.isFinite(args.progressMeters) ? args.progressMeters : 0));
  const remainSeconds = (distTo / 1000) * pace;
  return {
    etaMs: args.nowMs + remainSeconds * 1000,
    remainSeconds
  };
}
