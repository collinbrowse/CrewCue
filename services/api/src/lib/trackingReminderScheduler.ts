/**
 * Tracking reminder pushes (runner and crew onboarding).
 *
 * A runner who hasn't started tracking gets a push 45 minutes before the race start and another
 * 5 minutes before. Paid races only. Not tracking means no accepted ping recorded since 60
 * minutes before the start. A pre-start (test) ping counts: it is accepted and stored in the
 * track like any other ping, only kept out of the projection (raceRooms.ts `isPreStartPing`).
 *
 * Every minute a tick looks at rooms starting in the next 45 minutes. Each reminder has a window,
 * t45 [start − 45 min, start − 40 min) and t5 [start − 5 min, start), and a tick outside it never
 * sends it: an API that was down through T-45 skips t45 and still sends t5. Nothing is sent once
 * the race has started.
 *
 * Sent once across instances (risks R1, R20): an instance first inserts a claim row in
 * `tracking_reminders_sent` (unique on room, slot and race start) and sends only when its insert
 * won. Memory mode keeps the same key in process. A crash between the claim and the send skips
 * that reminder; it is never sent twice. The start is in the key, so moving it re-arms both.
 *
 * The push goes to the runner only (`room.athleteId`), on every device they registered for chat
 * push, through `dispatchChatPush` with type "tracking" and the roomId. The copy counts the
 * minutes left; it never shows a clock time.
 */
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { ChatPushDeviceRecord, RaceRoom } from "@crewcue/contracts";
import { hasTrackPointSince } from "./athletePingTrack.js";
import { isRoomPaid } from "./billingEntitlement.js";
import { listChatPushDevicesForUsers } from "./chatPersistence.js";
import { devicesToTargets, dispatchChatPush } from "./chatPushDispatch.js";
import { getPersistencePool } from "./roomPersistence.js";

const MINUTE_MS = 60_000;

/** How often the scheduler ticks. Each window is 5 minutes wide, so a tick lands in it. */
export const TRACKING_REMINDER_INTERVAL_MS = MINUTE_MS;
/** A ping recorded at or after `start − 60 min` means the runner is tracking. */
export const TRACKING_REMINDER_PING_LOOKBACK_MS = 60 * MINUTE_MS;
/** Claim rows older than this are deleted; every window is long closed by then. */
export const TRACKING_REMINDER_RETENTION_MS = 3 * 24 * 60 * MINUTE_MS;
const PRUNE_EVERY_MS = 60 * MINUTE_MS;
/** `stop()` waits this long at most for a tick in flight, so a hung push can't hold up shutdown. */
const DEFAULT_STOP_WAIT_MS = 5_000;

export type TrackingReminderSlot = "t45" | "t5";

/** A slot sends only while `start − opensBeforeStartMs <= now < start − closesBeforeStartMs`. */
export const TRACKING_REMINDER_WINDOWS: ReadonlyArray<{
  slot: TrackingReminderSlot;
  opensBeforeStartMs: number;
  closesBeforeStartMs: number;
}> = [
  { slot: "t45", opensBeforeStartMs: 45 * MINUTE_MS, closesBeforeStartMs: 40 * MINUTE_MS },
  { slot: "t5", opensBeforeStartMs: 5 * MINUTE_MS, closesBeforeStartMs: 0 }
];

/** Rooms starting within this long from now can have an open window (t45 opens 45 min out). */
export const TRACKING_REMINDER_LOOKAHEAD_MS = 45 * MINUTE_MS;

/** The slot whose window `nowMs` is in, if any. */
export function trackingReminderSlotAt(raceStartMs: number, nowMs: number): TrackingReminderSlot | undefined {
  for (const window of TRACKING_REMINDER_WINDOWS) {
    if (nowMs >= raceStartMs - window.opensBeforeStartMs && nowMs < raceStartMs - window.closesBeforeStartMs) {
      return window.slot;
    }
  }
  return undefined;
}

/** Push copy: the whole minutes left, rounded up ("45 minutes", "5 minutes", "1 minute"). */
export function trackingReminderCopy(raceStartMs: number, nowMs: number): { title: string; body: string } {
  const minutes = Math.max(1, Math.ceil((raceStartMs - nowMs) / MINUTE_MS));
  const unit = minutes === 1 ? "minute" : "minutes";
  return {
    title: "Start tracking",
    body: `Your race starts in ${minutes} ${unit}. Start tracking so your crew can follow you.`
  };
}

// ---------------------------------------------------------------------------
// Claims: `tracking_reminders_sent` in Postgres, an in-process map in memory mode.
// ---------------------------------------------------------------------------

/** Memory mode: claim key → claim time (ms). Shared by every scheduler in the process. */
const memoryClaims = new Map<string, number>();

function claimKey(roomId: string, slot: TrackingReminderSlot, raceStartMs: number): string {
  return `${roomId}|${slot}|${raceStartMs}`;
}

export type TrackingReminderClaim = "claimed" | "taken" | "room_gone";

/**
 * Claim one reminder before sending it. "claimed": this caller won and must send. "taken":
 * another tick or instance already did. "room_gone": the room row was deleted after the room was
 * listed (Postgres foreign key), so there is nothing to remind.
 */
export async function claimTrackingReminder(
  roomId: string,
  slot: TrackingReminderSlot,
  raceStartMs: number,
  nowMs: number
): Promise<TrackingReminderClaim> {
  const pool = getPersistencePool();
  if (!pool) {
    // No await between the check and the set: two ticks in this process can't both claim.
    const key = claimKey(roomId, slot, raceStartMs);
    if (memoryClaims.has(key)) {
      return "taken";
    }
    memoryClaims.set(key, nowMs);
    return "claimed";
  }
  try {
    const result = await pool.query(
      `INSERT INTO tracking_reminders_sent (room_id, slot, race_start_at, sent_at)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz)
       ON CONFLICT (room_id, slot, race_start_at) DO NOTHING`,
      [roomId, slot, new Date(raceStartMs).toISOString(), new Date(nowMs).toISOString()]
    );
    return result.rowCount === 1 ? "claimed" : "taken";
  } catch (err) {
    if ((err as { code?: unknown }).code === "23503") {
      return "room_gone";
    }
    throw err;
  }
}

/** Delete claims made before `beforeMs`. Returns how many. */
export async function pruneTrackingReminders(beforeMs: number): Promise<number> {
  const pool = getPersistencePool();
  if (!pool) {
    let pruned = 0;
    for (const [key, claimedAtMs] of [...memoryClaims.entries()]) {
      if (claimedAtMs < beforeMs) {
        memoryClaims.delete(key);
        pruned += 1;
      }
    }
    return pruned;
  }
  const result = await pool.query("DELETE FROM tracking_reminders_sent WHERE sent_at < $1::timestamptz", [
    new Date(beforeMs).toISOString()
  ]);
  return result.rowCount ?? 0;
}

/**
 * Room deletion, memory mode: drop the room's claims. Postgres rows go with the room row
 * (ON DELETE CASCADE), so this is a no-op there.
 */
export function forgetTrackingRemindersForRoom(roomId: string): void {
  const prefix = `${roomId}|`;
  for (const key of [...memoryClaims.keys()]) {
    if (key.startsWith(prefix)) {
      memoryClaims.delete(key);
    }
  }
}

export type TrackingReminderClaimRow = { slot: TrackingReminderSlot; raceStartAt: string; sentAt: string };

/** The claims stored for a room, oldest start first. For tests and support. */
export async function listTrackingReminderClaims(roomId: string): Promise<TrackingReminderClaimRow[]> {
  const pool = getPersistencePool();
  if (!pool) {
    const prefix = `${roomId}|`;
    return [...memoryClaims.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, claimedAtMs]) => {
        const [, slot, startMs] = key.split("|");
        return {
          slot: slot as TrackingReminderSlot,
          raceStartAt: new Date(Number(startMs)).toISOString(),
          sentAt: new Date(claimedAtMs).toISOString()
        };
      })
      .sort((a, b) => a.raceStartAt.localeCompare(b.raceStartAt) || a.slot.localeCompare(b.slot));
  }
  const result = await pool.query<{ slot: TrackingReminderSlot; race_start_at: Date; sent_at: Date }>(
    `SELECT slot, race_start_at, sent_at FROM tracking_reminders_sent
     WHERE room_id = $1
     ORDER BY race_start_at ASC, slot ASC`,
    [roomId]
  );
  return result.rows.map((row) => ({
    slot: row.slot,
    raceStartAt: row.race_start_at.toISOString(),
    sentAt: row.sent_at.toISOString()
  }));
}

/** Test-only: clear memory mode's claims. No-op against Postgres. */
export function _resetTrackingRemindersForTests(): void {
  memoryClaims.clear();
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export type TrackingReminderRoom = Pick<
  RaceRoom,
  "id" | "athleteId" | "status" | "raceStartAt" | "entitlement" | "memberships"
>;

/** Rooms whose start is after `fromMs` and at most `toMs` (raceRooms.ts `listRaceRoomsStartingBetween`). */
export type TrackingReminderListRooms = (fromMs: number, toMs: number) => Promise<TrackingReminderRoom[]>;

export type TrackingReminderResult =
  /** Claimed and handed to the push transport. */
  | "sent"
  /** Claimed, but the push transport threw. Not retried: a duplicate is worse than a miss. */
  | "dispatch_failed"
  /** Another tick or instance claimed it. */
  | "already_sent"
  /** The runner has an accepted ping since `start − 60 min`. */
  | "tracking"
  /** The race is `unpaid` or `expired`. */
  | "not_paid"
  /** The room is not `active`, so the API would refuse the runner's pings. */
  | "not_active"
  /**
   * `athleteId` is not on the roster: they can't send pings to this room, and `athleteId` is set
   * by the room's creator (risk R17), so a push would reach someone outside the race.
   */
  | "runner_not_member"
  /** The runner has no push device yet. Not claimed, so a later tick in the window can send. */
  | "no_devices"
  /** The room was deleted after it was listed. */
  | "room_gone"
  /** Checking or claiming threw; logged, and a later tick in the window tries again. */
  | "error";

export type TrackingReminderOutcome = {
  roomId: string;
  slot: TrackingReminderSlot;
  /** The start the reminder is for, normalized ISO. */
  raceStartAt: string;
  result: TrackingReminderResult;
  /** Devices the transport reported delivered, when sent. */
  delivered?: number;
};

export type TrackingReminderSchedulerOptions = {
  listRooms: TrackingReminderListRooms;
  log: Pick<FastifyBaseLogger, "info" | "warn">;
  /** Clock (ms). Default `Date.now`. */
  now?: () => number;
  /** Tick interval (ms). Default {@link TRACKING_REMINDER_INTERVAL_MS}. */
  intervalMs?: number;
  /** Don't tick on start; the first tick waits one interval. */
  skipFirstRun?: boolean;
  /** Longest `stop()` waits for a tick in flight (ms). Default 5 s. */
  stopWaitMs?: number;
};

export type TrackingReminderScheduler = {
  /** One pass at `now()`. Never throws. Returns an outcome per room with an open window. */
  tick(): Promise<TrackingReminderOutcome[]>;
  /** Start the timer (idempotent). Ticks right away unless `skipFirstRun`. */
  start(): void;
  /** Stop the timer and wait (up to `stopWaitMs`) for a tick it started. */
  stop(): Promise<void>;
  readonly running: boolean;
};

export function createTrackingReminderScheduler(opts: TrackingReminderSchedulerOptions): TrackingReminderScheduler {
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? TRACKING_REMINDER_INTERVAL_MS;
  const stopWaitMs = opts.stopWaitMs ?? DEFAULT_STOP_WAIT_MS;
  const log = opts.log;
  let handle: ReturnType<typeof setInterval> | undefined;
  let timerTick: Promise<unknown> | undefined;
  let lastPruneAtMs: number | undefined;

  async function prune(nowMs: number): Promise<void> {
    if (lastPruneAtMs !== undefined && nowMs - lastPruneAtMs < PRUNE_EVERY_MS) {
      return;
    }
    lastPruneAtMs = nowMs;
    try {
      const pruned = await pruneTrackingReminders(nowMs - TRACKING_REMINDER_RETENTION_MS);
      if (pruned > 0) {
        log.info({ trackingReminders: { pruned } }, "tracking_reminder_prune");
      }
    } catch (err) {
      log.warn({ err, trackingReminders: { phase: "prune" } }, "tracking_reminder_prune_failed");
    }
  }

  async function remind(room: TrackingReminderRoom, nowMs: number): Promise<TrackingReminderOutcome | undefined> {
    const raceStartMs = Date.parse(room.raceStartAt ?? "");
    if (!Number.isFinite(raceStartMs)) {
      return undefined;
    }
    const slot = trackingReminderSlotAt(raceStartMs, nowMs);
    if (!slot) {
      return undefined;
    }
    const outcome = (result: TrackingReminderResult, delivered?: number): TrackingReminderOutcome => ({
      roomId: room.id,
      slot,
      raceStartAt: new Date(raceStartMs).toISOString(),
      result,
      ...(delivered !== undefined ? { delivered } : {})
    });
    if (!isRoomPaid(room)) {
      return outcome("not_paid");
    }
    if (room.status !== "active") {
      return outcome("not_active");
    }
    if (!room.memberships.some((member) => member.userId === room.athleteId)) {
      return outcome("runner_not_member");
    }
    let devices: ChatPushDeviceRecord[];
    try {
      if (await hasTrackPointSince(room.id, raceStartMs - TRACKING_REMINDER_PING_LOOKBACK_MS)) {
        return outcome("tracking");
      }
      devices = await listChatPushDevicesForUsers([room.athleteId]);
      if (devices.length === 0) {
        return outcome("no_devices");
      }
      const claim = await claimTrackingReminder(room.id, slot, raceStartMs, nowMs);
      if (claim !== "claimed") {
        return outcome(claim === "taken" ? "already_sent" : "room_gone");
      }
    } catch (err) {
      log.warn({ err, trackingReminder: { roomId: room.id, slot } }, "tracking_reminder_check_failed");
      return outcome("error");
    }
    const copy = trackingReminderCopy(raceStartMs, nowMs);
    try {
      const dispatch = await dispatchChatPush({
        kind: "tracking",
        roomId: room.id,
        title: copy.title,
        body: copy.body,
        targets: devicesToTargets(devices)
      });
      // Metadata only: never tokens.
      log.info(
        {
          trackingReminder: {
            roomId: room.id,
            slot,
            delivered: dispatch.delivered,
            attempts: dispatch.attempts,
            failures: dispatch.failures.length
          }
        },
        "tracking_reminder_sent"
      );
      return outcome("sent", dispatch.delivered);
    } catch (err) {
      log.warn({ err, trackingReminder: { roomId: room.id, slot } }, "tracking_reminder_dispatch_failed");
      return outcome("dispatch_failed");
    }
  }

  async function tick(): Promise<TrackingReminderOutcome[]> {
    const nowMs = now();
    await prune(nowMs);
    let rooms: TrackingReminderRoom[];
    try {
      rooms = await opts.listRooms(nowMs, nowMs + TRACKING_REMINDER_LOOKAHEAD_MS);
    } catch (err) {
      log.warn({ err, trackingReminders: { phase: "list_rooms" } }, "tracking_reminder_pass_failed");
      return [];
    }
    const outcomes: TrackingReminderOutcome[] = [];
    for (const room of rooms) {
      try {
        const outcome = await remind(room, nowMs);
        if (outcome) {
          outcomes.push(outcome);
        }
      } catch (err) {
        // A malformed room (a stored payload missing fields) must not stop the others.
        log.warn({ err, trackingReminder: { roomId: room?.id } }, "tracking_reminder_check_failed");
      }
    }
    if (outcomes.length > 0) {
      log.info(
        {
          trackingReminders: {
            scanned: rooms.length,
            sent: outcomes.filter((o) => o.result === "sent").length,
            outcomes: outcomes.map((o) => ({ roomId: o.roomId, slot: o.slot, result: o.result }))
          }
        },
        "tracking_reminder_pass"
      );
    }
    return outcomes;
  }

  function runFromTimer(): void {
    // One timer tick at a time: a slow pass is not stacked on. Claims keep overlap safe anyway.
    if (timerTick) {
      return;
    }
    timerTick = tick()
      .catch((err: unknown) => {
        log.warn({ err, trackingReminders: { phase: "tick" } }, "tracking_reminder_pass_failed");
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
          timeout = setTimeout(resolve, stopWaitMs);
          timeout.unref?.();
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
 * Run the scheduler for an app's lifetime: it starts when the app is ready (`listen` included)
 * and stops on `app.close()`. server.ts calls this before `listen`.
 */
export function attachTrackingReminderScheduler(
  app: FastifyInstance,
  opts: Omit<TrackingReminderSchedulerOptions, "log"> & { log?: TrackingReminderSchedulerOptions["log"] }
): TrackingReminderScheduler {
  const scheduler = createTrackingReminderScheduler({ ...opts, log: opts.log ?? app.log });
  app.addHook("onReady", async () => {
    scheduler.start();
  });
  app.addHook("onClose", async () => {
    await scheduler.stop();
  });
  return scheduler;
}
