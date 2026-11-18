/**
 * Unpaid race expiry (runner and crew onboarding).
 *
 * A runner can set up a race and see the finish-only teaser before paying. A race still `unpaid`
 * 30 days after it was created, and never paid, is deleted, with everything keyed by it, through
 * the same full delete account deletion uses (`deleteRaceRoomAndData`), but never sooner than 24
 * hours after its creator was warned: its `expiry_1d` reminder must have been claimed at least a
 * day before (lib/unpaidRaceReminderScheduler.ts). A race created long ago gets that reminder on
 * the first reminder tick and is deleted a day later at the soonest. Paid and expired races are
 * never touched, and neither is a race with any billing grant: a refund (or a store EXPIRATION)
 * revokes the grant and puts the race back to `unpaid`, but a race someone paid for, raced and
 * chatted in is not an abandoned teaser. Nor is any race whose creator has an unattached grant
 * (R25: a purchase the webhook stored with no room), since that creator may have paid for it. A
 * race whose payload has no parsable `createdAt` is kept: it has no age.
 *
 * Every hour a tick lists the oldest never-paid unpaid races past the cutoff whose warning is a day
 * old (a slim query: id, entitlement status, creation time; never the payload with the course
 * GPX), at most `batchSize` of them, so a backlog drains over several ticks instead of one long
 * pass. Each race is re-read under its room lock before anything is deleted, and again as its row
 * is deleted (Postgres: the stored row, locked until the delete commits, with the grants and the
 * warning read on that same transaction), and deleted only if it is still unpaid, still past the
 * cutoff, still warned a day ago, still has no grant, and its creator still has no unattached
 * grant. A grant write takes the room row's key
 * share lock (billingStore.ts `upsertBillingGrant`), so a purchase either lands before the lock
 * and keeps the race, or waits for the delete and finds the room gone; it never lands between the
 * last check and the delete.
 *
 * Safe on several instances at once (risks R1, R20): the first to delete a race wins, and the
 * others find it gone, which is not an error. Each tick logs counts only, never ids or user data.
 */
import type { FastifyBaseLogger } from "fastify";
import type { RaceRoomDeleteCondition, RaceRoomDeletion } from "../routes/raceRooms.js";
import { ensureBillingStoreReady, roomHasBillingGrants, userHasUnattachedBillingGrant } from "./billingStore.js";
import { deleteRaceRoomAndData } from "./raceRoomDeletion.js";
import type { RaceRoomExpiryFields } from "./roomPersistence.js";
import {
  isPastFinalReminderGrace,
  UNPAID_FINAL_REMINDER_GRACE_MS,
  UNPAID_RACE_TTL_MS,
  unpaidFinalReminderClaimedAt
} from "./unpaidRaceReminderScheduler.js";

const HOUR_MS = 60 * 60_000;

/**
 * Whether the API runs the sweeper and the unpaid-race reminders (server.ts starts both). The
 * sweeper deletes only races whose runner was warned a day before (`expiry_1d`), so turning it on
 * deletes no race on its first day: the first reminder tick warns every older unpaid race (R32).
 */
export const UNPAID_RACE_EXPIRY_ENABLED = true;
/**
 * The age past which an unpaid race is deleted (30 days), and how long after the 1-day warning
 * (24 hours). Owned by lib/unpaidRaceReminderScheduler.ts, which times the warnings from them.
 */
export { UNPAID_FINAL_REMINDER_GRACE_MS, UNPAID_RACE_TTL_MS };
/** How often the sweeper ticks. */
export const UNPAID_RACE_EXPIRY_INTERVAL_MS = HOUR_MS;
/** Most races one tick deletes; the rest wait for the next tick. */
export const UNPAID_RACE_EXPIRY_BATCH_SIZE = 100;
/** `stop()` waits this long at most for a tick in flight, so a hung delete can't hold up shutdown. */
const DEFAULT_STOP_WAIT_MS = 5_000;

/**
 * Whether the race is past its unpaid life at `nowMs`: still `unpaid` and created at least 30
 * days before. A missing or unparsable creation time is never expired.
 */
export function isUnpaidRaceExpired(
  room: Pick<RaceRoomExpiryFields, "entitlementStatus" | "createdAt">,
  nowMs: number
): boolean {
  if (room.entitlementStatus !== "unpaid") {
    return false;
  }
  const createdMs = Date.parse(room.createdAt ?? "");
  return Number.isFinite(createdMs) && nowMs - createdMs >= UNPAID_RACE_TTL_MS;
}

/**
 * The sweeper's question, asked of the room as stored, under its lock, right before anything is
 * deleted: still expired at `now()`, its `expiry_1d` reminder claimed at least 24 hours before,
 * no billing grant, active or revoked (a race paid once, or a purchase recorded before the room
 * lock was taken), and no unattached grant bought by its creator (R25: a purchase the webhook
 * stored with no room, so the creator may be a paying runner whose race still reads `unpaid`).
 * The claim and the grants are read on the locking transaction's client (`db`), never on a second
 * pool connection.
 */
export function unpaidRaceDeleteCondition(now: () => number = Date.now): RaceRoomDeleteCondition {
  return async (latest, db) => {
    const nowMs = now();
    if (!isUnpaidRaceExpired(latest, nowMs)) {
      return false;
    }
    if (!isPastFinalReminderGrace(await unpaidFinalReminderClaimedAt(latest.id, db), nowMs)) {
      return false;
    }
    if (await roomHasBillingGrants(latest.id, db)) {
      return false;
    }
    return !(await userHasUnattachedBillingGrant(latest.creatorId, db));
  };
}

/**
 * Unpaid races created at or before `createdBeforeMs` whose `expiry_1d` reminder was claimed at or
 * before `finalReminderClaimedBeforeMs`, oldest first, at most `limit` (raceRooms.ts
 * `listUnpaidRaceRoomsCreatedBefore`).
 */
export type UnpaidRaceExpiryListRooms = (
  createdBeforeMs: number,
  limit: number,
  finalReminderClaimedBeforeMs: number
) => Promise<RaceRoomExpiryFields[]>;

/** Deletes the room when `onlyIf` agrees (lib/raceRoomDeletion.ts `deleteRaceRoomAndData`). */
export type UnpaidRaceExpiryDeleteRoom = (
  roomId: string,
  onlyIf: RaceRoomDeleteCondition
) => Promise<RaceRoomDeletion>;

/**
 * The sweeper's default delete: the full delete, failing (so the race stays listed and the next
 * tick retries) when the photo store deleted fewer chat photos than it was given. Account
 * deletion and chat retention keep going past such a photo.
 */
export const deleteUnpaidRaceRoom: UnpaidRaceExpiryDeleteRoom = (roomId, onlyIf) =>
  deleteRaceRoomAndData(roomId, onlyIf, { requireEveryChatPhotoDeleted: true });

export type UnpaidRaceExpiryResult =
  /** Deleted by this tick, with all its data. */
  | "deleted"
  /** Re-read before the delete and no longer expired (paid, a grant recorded, or not that old): kept. */
  | "kept"
  /** Already deleted (another tick, instance or account deletion). */
  | "gone"
  /**
   * The delete threw; logged. The room row is deleted last but one, so a throw before it (a chat
   * photo the store didn't delete included) leaves the race listed and the next tick runs the whole
   * delete again. A throw after it (the final pass over chat, effort and history) can leave what
   * was written in between.
   */
  | "error";

export type UnpaidRaceExpiryOutcome = { roomId: string; result: UnpaidRaceExpiryResult };

export type UnpaidRaceExpirySchedulerOptions = {
  listRooms: UnpaidRaceExpiryListRooms;
  /** Default {@link deleteUnpaidRaceRoom}. */
  deleteRoom?: UnpaidRaceExpiryDeleteRoom;
  log: Pick<FastifyBaseLogger, "info" | "warn">;
  /** Clock (ms). Default `Date.now`. */
  now?: () => number;
  /** Tick interval (ms). Default {@link UNPAID_RACE_EXPIRY_INTERVAL_MS}. */
  intervalMs?: number;
  /** Most races one tick deletes. Default {@link UNPAID_RACE_EXPIRY_BATCH_SIZE}. */
  batchSize?: number;
  /** Don't tick on start; the first tick waits one interval. */
  skipFirstRun?: boolean;
  /** Longest `stop()` waits for a tick in flight (ms). Default 5 s. */
  stopWaitMs?: number;
};

export type UnpaidRaceExpiryScheduler = {
  /** One pass at `now()`. Never throws. Returns an outcome per expired race it tried. */
  tick(): Promise<UnpaidRaceExpiryOutcome[]>;
  /** Start the timer (idempotent). Ticks right away unless `skipFirstRun`. */
  start(): void;
  /**
   * Stop the timer, end a tick in flight at the next room boundary (the race being deleted is
   * finished, the next is not started), and wait (up to `stopWaitMs`) for a tick it started.
   */
  stop(): Promise<void>;
  readonly running: boolean;
};

export function createUnpaidRaceExpiryScheduler(opts: UnpaidRaceExpirySchedulerOptions): UnpaidRaceExpiryScheduler {
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? UNPAID_RACE_EXPIRY_INTERVAL_MS;
  const batchSize = opts.batchSize ?? UNPAID_RACE_EXPIRY_BATCH_SIZE;
  const stopWaitMs = opts.stopWaitMs ?? DEFAULT_STOP_WAIT_MS;
  const deleteRoom = opts.deleteRoom ?? deleteUnpaidRaceRoom;
  const log = opts.log;
  let handle: ReturnType<typeof setInterval> | undefined;
  let timerTick: Promise<unknown> | undefined;
  /** Set by `stop()`: a tick in flight ends before its next room. */
  let stopping = false;

  /** Asked under the room lock, of the room as stored right now. */
  const stillExpired = unpaidRaceDeleteCondition(now);

  async function tick(): Promise<UnpaidRaceExpiryOutcome[]> {
    const nowMs = now();
    let rooms: RaceRoomExpiryFields[];
    try {
      // The grant table first, so the condition never creates it while it holds a room lock.
      await ensureBillingStoreReady();
      rooms = await opts.listRooms(nowMs - UNPAID_RACE_TTL_MS, batchSize, nowMs - UNPAID_FINAL_REMINDER_GRACE_MS);
    } catch (err) {
      log.warn({ err, unpaidRaceExpiry: { phase: "list_rooms" } }, "unpaid_race_expiry_pass_failed");
      return [];
    }
    const outcomes: UnpaidRaceExpiryOutcome[] = [];
    for (const room of rooms.slice(0, batchSize)) {
      // A deploy's shutdown ends the batch here, between two races, never inside a delete.
      if (stopping) {
        break;
      }
      if (!isUnpaidRaceExpired(room, nowMs)) {
        continue;
      }
      try {
        outcomes.push({ roomId: room.id, result: await deleteRoom(room.id, stillExpired) });
      } catch (err) {
        // One failed delete must not stop the others. No room id: logs carry counts only.
        log.warn({ err, unpaidRaceExpiry: { phase: "delete" } }, "unpaid_race_expiry_delete_failed");
        outcomes.push({ roomId: room.id, result: "error" });
      }
    }
    const count = (result: UnpaidRaceExpiryResult) => outcomes.filter((o) => o.result === result).length;
    log.info(
      {
        unpaidRaceExpiry: {
          listed: rooms.length,
          deleted: count("deleted"),
          kept: count("kept"),
          gone: count("gone"),
          failed: count("error")
        }
      },
      "unpaid_race_expiry_pass"
    );
    return outcomes;
  }

  function runFromTimer(): void {
    // One timer tick at a time: a slow pass is not stacked on. The re-read keeps overlap safe anyway.
    if (timerTick) {
      return;
    }
    timerTick = tick()
      .catch((err: unknown) => {
        log.warn({ err, unpaidRaceExpiry: { phase: "tick" } }, "unpaid_race_expiry_pass_failed");
      })
      .finally(() => {
        timerTick = undefined;
      });
  }

  return {
    tick,
    start() {
      if (handle) {
        return;
      }
      stopping = false;
      handle = setInterval(runFromTimer, intervalMs);
      // Don't keep the process alive solely for the timer.
      if (typeof handle.unref === "function") {
        handle.unref();
      }
      if (!opts.skipFirstRun) {
        runFromTimer();
      }
    },
    async stop() {
      stopping = true;
      if (handle) {
        clearInterval(handle);
        handle = undefined;
      }
      if (!timerTick) {
        return;
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        timerTick,
        new Promise<void>((resolve) => {
          // Kept ref'd on purpose: it is bounded by stopWaitMs, and an unref'd wait lets the
          // event loop drain while close() is still pending on a hung tick.
          timeout = setTimeout(resolve, stopWaitMs);
        })
      ]);
      clearTimeout(timeout);
    },
    get running() {
      return handle !== undefined;
    }
  };
}
