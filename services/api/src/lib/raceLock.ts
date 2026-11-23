import type { RaceRoom } from "@crewcue/contracts";

/**
 * The race lock. A Race Pass pays for one race. Once that race has been run, its course and start
 * are fixed, so the same paid room cannot be re-pointed at another race.
 *
 * A paid room is locked from the first of:
 * - the first accepted runner ping recorded at or after `raceStartAt` (stored as `raceLockedAt`,
 *   written once by `POST /pings` or `POST /pings/batch`), or
 * - 48 hours after `raceStartAt`, with or without pings (computed, never stored).
 *
 * An unpaid or expired room is never locked, whatever is stored. Locked means: no new route line
 * (`PUT /course` with a different route or GPX, `PUT /map-workspace` with a different driving
 * layer) and no new start (`PATCH /race-start`, or a different `raceStartAt` on `PUT /course`),
 * except a start within 12 hours of the locking ping (a delayed gun; see `raceStartChangeAllowed`).
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
 * How far a locked race's start may still move from its first race ping: enough for a delayed gun
 * or a start entered at the wrong hour on race morning, not enough to re-point the room at a race
 * on another day.
 */
export const RACE_LOCK_START_SLACK_MS = 12 * 60 * 60 * 1000;

/**
 * Whether the start may become `nextStartIso`. Always on an unlocked race, and to the start it
 * already has. On a race locked by a ping, within {@link RACE_LOCK_START_SLACK_MS} of that ping
 * (a delayed gun turns the early race pings back into test pings). On a race locked only by the
 * 48-hour rule, never: it was not run, and its window has passed.
 */
export function raceStartChangeAllowed(room: RaceRoom, nextStartIso: string, nowMs: number): boolean {
  const nextMs = Date.parse(nextStartIso);
  if (!isRaceLocked(room, nowMs) || Date.parse(room.raceStartAt ?? "") === nextMs) {
    return true;
  }
  const pingLockMs = room.raceLockedAt ? Date.parse(room.raceLockedAt) : Number.NaN;
  return !Number.isNaN(pingLockMs) && !Number.isNaN(nextMs) && Math.abs(nextMs - pingLockMs) <= RACE_LOCK_START_SLACK_MS;
}

/**
 * Whether an accepted ping recorded at `recordedAtMs` should store the lock: a paid room with a
 * start, not locked by a ping yet, and the ping at or after the start.
 */
export function pingStartsRaceLock(room: RaceRoom, recordedAtMs: number): boolean {
  if (room.entitlement?.status !== "paid" || room.raceLockedAt) {
    return false;
  }
  const startMs = room.raceStartAt ? Date.parse(room.raceStartAt) : Number.NaN;
  return !Number.isNaN(startMs) && recordedAtMs >= startMs;
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
