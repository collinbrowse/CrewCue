import type {
  RaceCheckpointSplitRow,
  RaceCourseCheckpoint,
  RaceCourseCheckpointCutoff,
  RaceRoomProjection
} from "@crewcue/contracts";
import { slugToTitle } from "@crewcue/map-core";

const METERS_PER_MILE = 1609.344;

/** Station label for Pace UI: explicit title, else words from slug (never raw hyphenated id). */
export function checkpointDisplayTitle(cp: Pick<RaceCourseCheckpoint, "id" | "title">): string {
  const raw = (cp.title?.trim() || slugToTitle(cp.id)).trim();
  return raw.toUpperCase();
}

/** Miles from current course progress to this checkpoint along the course polyline (≥ 0). */
export function milesRemainingToCheckpoint(progressMeters: number, checkpointDistanceMeters: number | undefined): string {
  if (checkpointDistanceMeters === undefined || !Number.isFinite(checkpointDistanceMeters)) {
    return "—";
  }
  const mi = Math.max(0, checkpointDistanceMeters - progressMeters) / METERS_PER_MILE;
  return `${mi.toFixed(1)} mi`;
}

export function milesFromMeters(m: number): number {
  return m / METERS_PER_MILE;
}

/** Visited for UI / remove-disable: any manual entry, or auto with departure recorded. */
export function isCheckpointCompletedUi(split: RaceCheckpointSplitRow): boolean {
  return split.visits.some((visit) => {
    if (visit.manualEntry) {
      return true;
    }
    return visit.autoDetected?.departureRecordedAt != null;
  });
}

function latestAutoVisitInProgress(split: RaceCheckpointSplitRow): boolean {
  const withAuto = split.visits.filter((v) => v.autoDetected);
  const last = withAuto[withAuto.length - 1];
  if (!last?.autoDetected) {
    return false;
  }
  return last.autoDetected.firstSlowedAt != null && last.autoDetected.departureRecordedAt == null;
}

/** True when the latest auto visit indicates the athlete is stopped at this checkpoint (not yet departed). */
export function isAutoDwellAtCheckpoint(split: RaceCheckpointSplitRow | undefined): boolean {
  return split != null && latestAutoVisitInProgress(split);
}

/**
 * Index of the "current" checkpoint in `checkpoints` order, or `checkpoints.length` when focus is the finish line.
 */
export function currentCheckpointOrFinishIndex(
  checkpoints: RaceCourseCheckpoint[],
  splits: RaceCheckpointSplitRow[]
): number {
  const splitById = new Map(splits.map((s) => [s.checkpointId, s]));
  for (let i = 0; i < checkpoints.length; i++) {
    const sp = splitById.get(checkpoints[i]!.id);
    if (sp && latestAutoVisitInProgress(sp)) {
      return i;
    }
  }
  let lastDone = -1;
  for (let i = 0; i < checkpoints.length; i++) {
    const sp = splitById.get(checkpoints[i]!.id);
    if (sp && isCheckpointCompletedUi(sp)) {
      lastDone = i;
    }
  }
  const next = lastDone + 1;
  if (next >= checkpoints.length) {
    return checkpoints.length;
  }
  return next;
}

function manualArrivalElapsedSeconds(split: RaceCheckpointSplitRow, activatedAtMs: number): number | null {
  for (let i = split.visits.length - 1; i >= 0; i--) {
    const v = split.visits[i]!;
    const arr = v.manualEntry?.arrivalAt;
    if (arr) {
      const ms = Date.parse(arr);
      if (!Number.isNaN(ms)) {
        return Math.max(0, (ms - activatedAtMs) / 1000);
      }
    }
  }
  return null;
}

export type PaceAnchor = {
  anchorIndex: number;
  /** Elapsed seconds from race start at anchor (planned-time basis for delta math). */
  anchorPlannedElapsed: number;
  anchorActualElapsed: number;
};

/**
 * Anchor for forward projection: last GPS split with actual elapsed, else a more recent manual-only anchor.
 */
export function resolvePaceAnchor(splits: RaceCheckpointSplitRow[], activatedAtMs: number): PaceAnchor | null {
  let lastGpsIdx = -1;
  let lastGpsActual = 0;
  let lastGpsPlanned = 0;
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i]!;
    if (s.actualElapsedSecondsAtCross != null) {
      lastGpsIdx = i;
      lastGpsActual = s.actualElapsedSecondsAtCross;
      lastGpsPlanned = s.plannedElapsedSecondsAtCross;
    }
  }
  for (let i = splits.length - 1; i > lastGpsIdx; i--) {
    const s = splits[i]!;
    const man = manualArrivalElapsedSeconds(s, activatedAtMs);
    if (man != null) {
      return { anchorIndex: i, anchorPlannedElapsed: s.plannedElapsedSecondsAtCross, anchorActualElapsed: man };
    }
  }
  if (lastGpsIdx >= 0) {
    const s = splits[lastGpsIdx]!;
    return {
      anchorIndex: lastGpsIdx,
      anchorPlannedElapsed: s.plannedElapsedSecondsAtCross,
      anchorActualElapsed: lastGpsActual
    };
  }
  return null;
}

/** Elapsed seconds at CP used for clock + deviation (+ = ahead of plan). */
export function projectedElapsedSecondsAtSplit(
  split: RaceCheckpointSplitRow,
  splitIndex: number,
  anchor: PaceAnchor | null,
  activatedAtMs: number
): number {
  const planned = split.plannedElapsedSecondsAtCross;
  if (split.actualElapsedSecondsAtCross != null) {
    return split.actualElapsedSecondsAtCross;
  }
  const manual = manualArrivalElapsedSeconds(split, activatedAtMs);
  if (manual != null) {
    return manual;
  }
  if (anchor && splitIndex > anchor.anchorIndex) {
    return anchor.anchorActualElapsed + (planned - anchor.anchorPlannedElapsed);
  }
  return planned;
}

export function formatSignedMinutesDelta(deltaSeconds: number): string {
  const minutes = deltaSeconds / 60;
  const mag = Math.abs(minutes);
  const rounded = mag >= 10 ? Math.round(mag) : Math.round(mag * 10) / 10;
  if (minutes > 0) {
    return `+${rounded}m`;
  }
  if (minutes < 0) {
    return `-${rounded}m`;
  }
  return "0m";
}

export function deltaTone(deltaSeconds: number): "ahead" | "behind" | "neutral" {
  if (deltaSeconds > 30) {
    return "ahead";
  }
  if (deltaSeconds < -30) {
    return "behind";
  }
  return "neutral";
}

export function formatClockFromElapsed(activatedAtMs: number, elapsedSeconds: number): string {
  const t = new Date(activatedAtMs + elapsedSeconds * 1000);
  return t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Compact cutoff clock for in-row emphasis (no leading “Cutoff” word). */
export function formatCutoffClockOnly(
  cutoff: RaceCourseCheckpointCutoff | undefined,
  activatedAtMs: number | null
): string | undefined {
  if (!cutoff) {
    return undefined;
  }
  if (cutoff.mode === "time_of_day") {
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    if (activatedAtMs == null || Number.isNaN(activatedAtMs)) {
      return `${pad(cutoff.hour)}:${pad(cutoff.minute)}`;
    }
    const d = new Date(activatedAtMs);
    d.setHours(cutoff.hour, cutoff.minute, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const sec = cutoff.seconds;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) {
    return `+${h}h ${m}m`;
  }
  return `+${m}m`;
}

export function formatCutoffLabel(
  cutoff: RaceCourseCheckpointCutoff | undefined,
  activatedAtMs: number | null
): string | undefined {
  if (!cutoff) {
    return undefined;
  }
  if (cutoff.mode === "elapsed_from_start") {
    const sec = cutoff.seconds;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) {
      return `Cutoff +${h}h ${m}m`;
    }
    return `Cutoff +${m}m`;
  }
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  if (activatedAtMs != null) {
    const d = new Date(activatedAtMs);
    d.setHours(cutoff.hour, cutoff.minute, 0, 0);
    return `Cutoff ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return `Cutoff ${pad(cutoff.hour)}:${pad(cutoff.minute)}`;
}

export function plannedFinishElapsedSeconds(
  projection: Pick<RaceRoomProjection, "checkpointSplits" | "courseLengthMeters" | "plannedPaceSecondsPerKm">
): number {
  const splits = projection.checkpointSplits;
  if (splits.length === 0) {
    return 0;
  }
  const last = splits[splits.length - 1]!;
  const remainM = Math.max(0, projection.courseLengthMeters - last.distanceMetersFromStart);
  const pace = projection.plannedPaceSecondsPerKm;
  return last.plannedElapsedSecondsAtCross + (remainM / 1000) * pace;
}

export type PaceRailRowModel = {
  isActiveLeg: boolean;
  /** 0 = marker at top of band, 1 = bottom (in-leg or dwell progress). */
  fraction01: number;
};

function dwellStopFraction01(split: RaceCheckpointSplitRow, plannedStopSeconds: number, nowMs: number): number {
  const withAuto = split.visits.filter((v) => v.autoDetected);
  const last = withAuto[withAuto.length - 1]?.autoDetected;
  if (!last?.arrivalRecordedAt || last.departureRecordedAt != null) {
    return 0;
  }
  const arr = Date.parse(last.arrivalRecordedAt);
  if (Number.isNaN(arr)) {
    return 0;
  }
  const planned = Math.max(1, plannedStopSeconds);
  const elapsed = Math.max(0, (nowMs - arr) / 1000);
  return Math.min(1, elapsed / planned);
}

/**
 * Pace timeline rail: the row for checkpoint `rowIndex` shows the leg ending at that checkpoint
 * (from previous CP along-course distance to this CP). When that leg is current, the rail is “live”
 * (purple trunk + marker progress). Dwell at the station uses planned stop time vs wall clock.
 * When inactive, the marker rests at the **top** for upcoming legs, or **bottom** once that checkpoint
 * is departed or the race focus has moved past this row (`checkpointCompleted` or `rowIndex < currentIx`).
 */
export function paceRailCheckpointRowModel(
  rowIndex: number,
  currentIx: number,
  checkpointsLength: number,
  cumMetersAtCp: number[],
  progressMeters: number,
  split: RaceCheckpointSplitRow | undefined,
  plannedStopSecondsForDwell: number,
  nowMs: number,
  checkpointCompleted: boolean
): PaceRailRowModel {
  if (rowIndex !== currentIx || rowIndex >= checkpointsLength || rowIndex < 0) {
    const legDone = rowIndex < currentIx || checkpointCompleted;
    return { isActiveLeg: false, fraction01: legDone ? 1 : 0 };
  }
  if (split && latestAutoVisitInProgress(split)) {
    const planned = plannedStopSecondsForDwell > 0 ? plannedStopSecondsForDwell : split.plannedStopSeconds ?? 600;
    return { isActiveLeg: true, fraction01: dwellStopFraction01(split, planned, nowMs) };
  }
  const j = rowIndex;
  const prev = j > 0 ? (cumMetersAtCp[j - 1] ?? 0) : 0;
  const here = cumMetersAtCp[j] ?? 0;
  const segLen = Math.max(0, here - prev);
  if (segLen <= 0) {
    return { isActiveLeg: true, fraction01: 0 };
  }
  const t = (progressMeters - prev) / segLen;
  return { isActiveLeg: true, fraction01: Math.min(1, Math.max(0, t)) };
}

/** Finish row: leg from last checkpoint along course length to the finish. */
export function paceRailFinishRowModel(
  currentIx: number,
  checkpointsLength: number,
  lastCpMeters: number,
  courseLenMeters: number,
  progressMeters: number
): PaceRailRowModel {
  if (currentIx < checkpointsLength || checkpointsLength === 0) {
    return { isActiveLeg: false, fraction01: 0 };
  }
  const seg = Math.max(0, courseLenMeters - lastCpMeters);
  if (seg <= 0) {
    return { isActiveLeg: true, fraction01: 0 };
  }
  const t = (progressMeters - lastCpMeters) / seg;
  return { isActiveLeg: true, fraction01: Math.min(1, Math.max(0, t)) };
}

export function finishDeviationSeconds(projection: RaceRoomProjection, activatedAtMs: number): number {
  const plannedFinish = plannedFinishElapsedSeconds(projection);
  const projFinishMs = Date.parse(projection.etaFinishPlanIso);
  if (Number.isNaN(projFinishMs)) {
    return 0;
  }
  const projectedFinishElapsed = (projFinishMs - activatedAtMs) / 1000;
  return projectedFinishElapsed - plannedFinish;
}
