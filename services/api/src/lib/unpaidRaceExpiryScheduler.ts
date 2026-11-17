/**
 * Unpaid race expiry (runner and crew onboarding).
 *
 * A runner can set up a race and see the finish-only teaser before paying. A race still `unpaid`
 * 30 days after it was created is deleted, with everything keyed by it, through the same full
 * delete account deletion uses (`deleteRaceRoomAndData`). Paid and expired races are never
 * touched. A race whose payload has no parsable `createdAt` is kept: it has no age.
 *
 * Every hour a tick lists the oldest unpaid races past the cutoff (a slim query: id, entitlement
 * status, creation time; never the payload with the course GPX), at most `batchSize` of them, so
 * a backlog drains over several ticks instead of one long pass. Each race is re-read under its
 * room lock right before the delete (Postgres: the stored row, locked until the delete commits)
 * and deleted only if it is still unpaid, still past the cutoff, and has no active Race Pass grant
 * (one recorded by a webhook still waiting for that lock): a purchase that lands during the tick
 * wins.
 *
 * Safe on several instances at once (risks R1, R20): the first to delete a race wins, and the
 * others find it gone, which is not an error. Each tick logs counts only, never ids or user data.
 */
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { RaceRoomDeleteCondition, RaceRoomDeletion } from "../routes/raceRooms.js";
import { entitlementFromGrants } from "./billingEntitlement.js";
import { listBillingGrantsForRoom } from "./billingStore.js";
import { deleteRaceRoomAndData } from "./raceRoomDeletion.js";
import type { RaceRoomExpiryFields } from "./roomPersistence.js";

const HOUR_MS = 60 * 60_000;

/** An unpaid race is deleted once it is this old. */
export const UNPAID_RACE_TTL_MS = 30 * 24 * HOUR_MS;
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

/** Whether the room has an active grant that makes it paid (one the webhook may not have applied yet). */
async function hasActiveRacePass(roomId: string, nowMs: number): Promise<boolean> {
  const grants = await listBillingGrantsForRoom(roomId);
  return entitlementFromGrants(grants, new Date(nowMs).toISOString())?.status === "paid";
}

/**
 * Unpaid races created at or before `createdBeforeMs`, oldest first, at most `limit`
 * (raceRooms.ts `listUnpaidRaceRoomsCreatedBefore`).
 */
export type UnpaidRaceExpiryListRooms = (createdBeforeMs: number, limit: number) => Promise<RaceRoomExpiryFields[]>;

/** Deletes the room when `onlyIf` agrees (lib/raceRoomDeletion.ts `deleteRaceRoomAndData`). */
export type UnpaidRaceExpiryDeleteRoom = (
  roomId: string,
  onlyIf: RaceRoomDeleteCondition
) => Promise<RaceRoomDeletion>;

export type UnpaidRaceExpiryResult =
  /** Deleted by this tick, with all its data. */
  | "deleted"
  /** Re-read before the delete and no longer expired (paid, a pass grant waiting, or not that old): kept. */
  | "kept"
  /** Already deleted (another tick, instance or account deletion). */
  | "gone"
  /** The delete threw; logged, and the next tick tries again. */
  | "error";

export type UnpaidRaceExpiryOutcome = { roomId: string; result: UnpaidRaceExpiryResult };

export type UnpaidRaceExpirySchedulerOptions = {
  listRooms: UnpaidRaceExpiryListRooms;
  /** Default {@link deleteRaceRoomAndData}. */
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
  /** Stop the timer and wait (up to `stopWaitMs`) for a tick it started. */
  stop(): Promise<void>;
  readonly running: boolean;
};

export function createUnpaidRaceExpiryScheduler(opts: UnpaidRaceExpirySchedulerOptions): UnpaidRaceExpiryScheduler {
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? UNPAID_RACE_EXPIRY_INTERVAL_MS;
  const batchSize = opts.batchSize ?? UNPAID_RACE_EXPIRY_BATCH_SIZE;
  const stopWaitMs = opts.stopWaitMs ?? DEFAULT_STOP_WAIT_MS;
  const deleteRoom = opts.deleteRoom ?? deleteRaceRoomAndData;
  const log = opts.log;
  let handle: ReturnType<typeof setInterval> | undefined;
  let timerTick: Promise<unknown> | undefined;

  /** Asked under the room lock, of the room as stored right now. */
  const stillExpired: RaceRoomDeleteCondition = async (latest) => {
    const atMs = now();
    return isUnpaidRaceExpired(latest, atMs) && !(await hasActiveRacePass(latest.id, atMs));
  };

  async function tick(): Promise<UnpaidRaceExpiryOutcome[]> {
    const nowMs = now();
    let rooms: RaceRoomExpiryFields[];
    try {
      rooms = await opts.listRooms(nowMs - UNPAID_RACE_TTL_MS, batchSize);
    } catch (err) {
      log.warn({ err, unpaidRaceExpiry: { phase: "list_rooms" } }, "unpaid_race_expiry_pass_failed");
      return [];
    }
    const outcomes: UnpaidRaceExpiryOutcome[] = [];
    for (const room of rooms.slice(0, batchSize)) {
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

/**
 * Run the sweeper for an app's lifetime: it starts when the app is ready (`listen` included) and
 * stops on `app.close()`. server.ts calls this before `listen`.
 */
export function attachUnpaidRaceExpiryScheduler(
  app: FastifyInstance,
  opts: Omit<UnpaidRaceExpirySchedulerOptions, "log"> & { log?: UnpaidRaceExpirySchedulerOptions["log"] }
): UnpaidRaceExpiryScheduler {
  const scheduler = createUnpaidRaceExpiryScheduler({ ...opts, log: opts.log ?? app.log });
  app.addHook("onReady", async () => {
    scheduler.start();
  });
  app.addHook("onClose", async () => {
    await scheduler.stop();
  });
  return scheduler;
}
