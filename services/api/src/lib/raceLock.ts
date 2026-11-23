import type { RaceRoom } from "@crewcue/contracts";

/**
 * The race lock. A Race Pass pays for one race. Once that race has been run, its course and start
 * are fixed, so the same paid room cannot be re-pointed at another race.
 *
 * A paid room is locked from the first of:
 * - the runner reaching the first aid station (the course's first checkpoint after the start) on
 *   race pings: the projection's crossing time there, stored once as `raceLockedAt` by
 *   `POST /pings` or `POST /pings/batch`, or
 * - 48 hours after the current `raceStartAt`, with or without pings (computed, never stored).
 *
 * Pings at the start line, test pings, and a runner waiting out a delayed or postponed start never
 * lock the race, so until the first aid station the start can move by any amount.
 *
 * An unpaid or expired room is never locked, whatever is stored. Locked means: no new route line
 * (`PUT /course` with a different route or GPX, `PUT /map-workspace` with a different driving
 * layer) and no new start (`PATCH /race-start`, or a different `raceStartAt` on `PUT /course`),
 * except a start in the 12 hours before the first aid station (see `raceStartChangeAllowed`).
 * Renaming, aid-station and checkpoint edits on the same route, and planned stops stay open.
 */
export const RACE_LOCK_AFTER_START_MS = 48 * 60 * 60 * 1000;

export const RACE_LOCKED_CODE = "race_locked";

export const RACE_LOCKED_ERROR =
  "This race has started, so its course and start time are locked. You can still rename it and edit aid stations.";

/** The lock as it applies now (ISO), or undefined when the room is not locked. */
export function effectiveRaceLockedAt(room: RaceRoom, nowMs: number): string | undefined {
  if (room.entitlement?.status !== "paid") {
    return undefined;
  }
  const startMs = room.raceStartAt ? Date.parse(room.raceStartAt) : Number.NaN;
  const graceLockMs = Number.isNaN(startMs) ? undefined : startMs + RACE_LOCK_AFTER_START_MS;
  const storedMs = room.raceLockedAt ? Date.parse(room.raceLockedAt) : Number.NaN;
  if (!Number.isNaN(storedMs)) {
    // A start moved later after the lock cannot be (the start is locked), so the stored time wins.
    return room.raceLockedAt;
  }
  if (graceLockMs !== undefined && nowMs >= graceLockMs) {
    return new Date(graceLockMs).toISOString();
  }
  return undefined;
}

export function isRaceLocked(room: RaceRoom, nowMs: number): boolean {
  return effectiveRaceLockedAt(room, nowMs) !== undefined;
}

/**
 * How long before the first aid station a locked race's start may still be put: enough to correct
 * a start entered at the wrong hour, not enough to re-point the room at a race on another day.
 * Anchored to the lock, so moves cannot be chained.
 */
export const RACE_LOCK_START_SLACK_MS = 12 * 60 * 60 * 1000;

/**
 * Whether the start may become `nextStartIso`. Always on an unlocked race, and to the start it
 * already has. On a race locked at the first aid station, any time in the
 * {@link RACE_LOCK_START_SLACK_MS} before that arrival (the runner started before reaching it).
 * On a race locked only by the 48-hour rule, never: it was not run, and its window has passed.
 */
export function raceStartChangeAllowed(room: RaceRoom, nextStartIso: string, nowMs: number): boolean {
  const nextMs = Date.parse(nextStartIso);
  if (!isRaceLocked(room, nowMs) || Date.parse(room.raceStartAt ?? "") === nextMs) {
    return true;
  }
  const pingLockMs = room.raceLockedAt ? Date.parse(room.raceLockedAt) : Number.NaN;
  return (
    !Number.isNaN(pingLockMs) &&
    !Number.isNaN(nextMs) &&
    nextMs <= pingLockMs &&
    pingLockMs - nextMs <= RACE_LOCK_START_SLACK_MS
  );
}

/**
 * The first aid station: the course's first checkpoint after the start (`checkpoints[0]`).
 * Undefined on a course with no checkpoint after the start, which only the 48-hour rule locks.
 */
export function firstAidStationId(room: RaceRoom): string | undefined {
  return room.course?.checkpoints[1]?.id;
}

/**
 * The lock time race pings have earned, given the projection's checkpoint crossings: the runner's
 * arrival at the first aid station, on a paid room with a start that is not locked by pings yet,
 * at or after the start. Undefined when the pings don't lock the race (yet).
 */
export function aidStationLockAt(room: RaceRoom, splitCrossedAt: Record<string, string>): string | undefined {
  if (room.entitlement?.status !== "paid" || room.raceLockedAt) {
    return undefined;
  }
  const aidId = firstAidStationId(room);
  const crossed = aidId === undefined ? undefined : splitCrossedAt[aidId];
  const crossedMs = crossed ? Date.parse(crossed) : Number.NaN;
  const startMs = room.raceStartAt ? Date.parse(room.raceStartAt) : Number.NaN;
  if (Number.isNaN(crossedMs) || Number.isNaN(startMs) || crossedMs < startMs) {
    return undefined;
  }
  return new Date(crossedMs).toISOString();
}

/** Thrown inside a room edit that a lock refuses; the route answers 409 `race_locked`. */
export class RaceLockedError extends Error {
  constructor() {
    super(RACE_LOCKED_CODE);
    this.name = "RaceLockedError";
  }
}

/** The room as responses carry it: `raceLockedAt` is the effective lock, absent when unlocked. */
export function withEffectiveRaceLock(room: RaceRoom, nowMs: number): RaceRoom {
  const lockedAt = effectiveRaceLockedAt(room, nowMs);
  if (lockedAt === room.raceLockedAt) {
    return room;
  }
  const shaped = { ...room };
  if (lockedAt) {
    shaped.raceLockedAt = lockedAt;
  } else {
    delete shaped.raceLockedAt;
  }
  return shaped;
}
