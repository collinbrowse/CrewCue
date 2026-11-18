/**
 * Unpaid-race reminder pushes (runner and crew onboarding).
 *
 * A race still `unpaid` 30 days after it was created, and never paid, is deleted
 * (lib/unpaidRaceExpiryScheduler.ts). Before that, its creator (`raceCreatorOf`: the one who pays,
 * whatever role they chose, usually the runner) gets up to three pushes, each once; other members
 * never do:
 *
 * - `expiry_7d`: due once `createdAt + 23 days` has passed ("will be deleted in N days", whole
 *   days rounded down, so a tick a few minutes after day 23 says 6).
 * - `expiry_1d`: due once `createdAt + 29 days` has passed ("will be deleted tomorrow"). When it is
 *   due, `expiry_7d` is skipped: only the more urgent one goes out.
 * - `race_soon`: due once `raceStartAt − 3 days` has passed, while the race is still in the future
 *   and starts before the race's expiry time ({@link unpaidRaceExpiresAtMs}).
 *
 * Each is "due once after X", not a window: a server that was down, or a race created before this
 * shipped, still gets it on the next tick (catch-up). A race 40 days old gets `expiry_1d` first.
 *
 * A race whose creator has an unattached billing grant (risk R25: a purchase the webhook stored with
 * no room) is never reminded, and the sweeper never deletes it: that creator may have paid for it.
 *
 * The sweeper deletes a race only once its `expiry_1d` claim is at least 24 hours old, so nobody
 * loses a race without that warning a day before. The claim is what counts, not the delivery: a
 * runner with no push device, or a creator no longer on the roster, still gets the claim (the slot
 * counts as passed), else the race would never expire.
 *
 * Sent once across instances (risks R1, R20): an instance first inserts a claim row in
 * `unpaid_reminders_sent` (primary key room and slot) and sends only when its insert won. Memory
 * mode keeps the same key in process. A crash between the claim and the send skips that reminder;
 * it is never sent twice. Claims go with the room (ON DELETE CASCADE).
 *
 * The claim also re-checks the race, since a pass can take a while to reach it (earlier rooms'
 * pushes) and the listing is that much older: Postgres inserts the row only while the stored room
 * is still `unpaid` with no billing grant for it and no unattached grant from its creator, in the
 * same statement. Memory mode checks the grants right before it claims (every purchase, comp and
 * fake purchase records a grant before it marks the room paid). A race paid in between gets
 * neither a claim nor a push ("paid").
 *
 * The push goes through `dispatchChatPush` with type "unlock" and the roomId, on every device the
 * creator registered for chat push. Its collapse key is `unlock:<roomId>`, so a newer reminder
 * replaces an unread older one but never a chat, schedule or tracking push. When `expiry_1d` and
 * `race_soon` are both claimed in one pass, `race_soon` is sent first, so the deletion warning is
 * the one left on the phone. It expires (24 hours for `expiry_*`, the race start for `race_soon`),
 * so a phone offline for days never shows a stale one. The copy is in lib/unpaidRaceReminderCopy.ts.
 *
 * Every 15 minutes a tick lists the candidates through a slim query (Postgres: the unpaid partial
 * indexes on `createdAt` and `raceStartAt`, a few fields, never the payload with the course GPX).
 */
import type { ChatPushDeviceRecord } from "@crewcue/contracts";
import type { FastifyBaseLogger } from "fastify";
import {
  ensureBillingStoreReady,
  listRoomIdsWithBillingGrants,
  userHasUnattachedBillingGrant
} from "./billingStore.js";
import { listChatPushDevicesForUsers } from "./chatPersistence.js";
import { devicesToTargets, dispatchChatPush } from "./chatPushDispatch.js";
import {
  creatorHasUnattachedGrantSql,
  getPersistencePool,
  type PersistenceQueryable,
  type RaceRoomReminderFields,
  type UnpaidReminderSlot
} from "./roomPersistence.js";
import { unpaidRaceReminderCopy } from "./unpaidRaceReminderCopy.js";

export type { UnpaidReminderSlot } from "./roomPersistence.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** An unpaid race is deleted once it is this old (and its 1-day reminder is a day old). */
export const UNPAID_RACE_TTL_MS = 30 * DAY_MS;
/** The sweeper waits this long after the `expiry_1d` claim before it deletes the race. */
export const UNPAID_FINAL_REMINDER_GRACE_MS = DAY_MS;
/** `expiry_7d` is due once the race is this old. */
export const UNPAID_REMINDER_7D_AFTER_MS = 23 * DAY_MS;
/** `expiry_1d` is due once the race is this old. */
export const UNPAID_REMINDER_1D_AFTER_MS = 29 * DAY_MS;
/** `race_soon` is due this long before the race start. */
export const UNPAID_REMINDER_RACE_SOON_BEFORE_MS = 3 * DAY_MS;
/** An `expiry_*` push the phone hasn't shown within this long is dropped. */
export const UNPAID_EXPIRY_REMINDER_PUSH_TTL_MS = DAY_MS;
/** How often the scheduler ticks. */
export const UNPAID_REMINDER_INTERVAL_MS = 15 * MINUTE_MS;
/** `stop()` waits this long at most for a tick in flight, so a hung push can't hold up shutdown. */
const DEFAULT_STOP_WAIT_MS = 5_000;

/** Claimed slots and when (ISO). */
export type UnpaidReminderClaims = Partial<Record<UnpaidReminderSlot, string>>;

/**
 * When an unpaid, never-paid race is deleted: the later of `createdAt + 30 days` and, once its
 * `expiry_1d` reminder is claimed, that claim + 24 hours. Undefined without a parsable `createdAt`
 * (such a race never expires). Routes send it as `unpaidExpiresAt`.
 */
export function unpaidRaceExpiresAtMs(
  createdAt: string | undefined,
  finalReminderClaimedAtMs: number | undefined
): number | undefined {
  const createdMs = Date.parse(createdAt ?? "");
  if (!Number.isFinite(createdMs)) {
    return undefined;
  }
  const ttlMs = createdMs + UNPAID_RACE_TTL_MS;
  return finalReminderClaimedAtMs === undefined || !Number.isFinite(finalReminderClaimedAtMs)
    ? ttlMs
    : Math.max(ttlMs, finalReminderClaimedAtMs + UNPAID_FINAL_REMINDER_GRACE_MS);
}

/** Whether an `expiry_1d` claim made at `claimedAtMs` is old enough for the sweeper at `nowMs`. */
export function isPastFinalReminderGrace(claimedAtMs: number | undefined, nowMs: number): boolean {
  return claimedAtMs !== undefined && Number.isFinite(claimedAtMs) && nowMs - claimedAtMs >= UNPAID_FINAL_REMINDER_GRACE_MS;
}

/** The expiry slot due at `nowMs` and not yet claimed, if any: `expiry_1d` over `expiry_7d`. */
export function unpaidExpiryReminderDue(
  room: { createdAt: string | undefined; claims: UnpaidReminderClaims },
  nowMs: number
): "expiry_7d" | "expiry_1d" | undefined {
  const createdMs = Date.parse(room.createdAt ?? "");
  if (!Number.isFinite(createdMs)) {
    return undefined;
  }
  if (nowMs >= createdMs + UNPAID_REMINDER_1D_AFTER_MS) {
    // The 7-day one is skipped for good: once the 1-day one is due it always is.
    return room.claims.expiry_1d === undefined ? "expiry_1d" : undefined;
  }
  if (nowMs >= createdMs + UNPAID_REMINDER_7D_AFTER_MS) {
    return room.claims.expiry_7d === undefined ? "expiry_7d" : undefined;
  }
  return undefined;
}

/**
 * Whether `race_soon` is due at `nowMs` and not yet claimed: `raceStartAt − 3 days` has passed,
 * the start is still ahead, and it is before the race's expiry time (a race deleted first gets the
 * expiry reminders instead). A race with no expiry time (no `createdAt`) is never deleted, so any
 * start is before it.
 */
export function unpaidRaceSoonReminderDue(
  room: { createdAt: string | undefined; raceStartAt: string | undefined; claims: UnpaidReminderClaims },
  nowMs: number
): boolean {
  if (room.claims.race_soon !== undefined) {
    return false;
  }
  const startMs = Date.parse(room.raceStartAt ?? "");
  if (!Number.isFinite(startMs) || nowMs < startMs - UNPAID_REMINDER_RACE_SOON_BEFORE_MS || nowMs >= startMs) {
    return false;
  }
  const expiresAtMs = unpaidRaceExpiresAtMs(room.createdAt, claimedAtMs(room.claims.expiry_1d));
  return expiresAtMs === undefined || startMs < expiresAtMs;
}

function claimedAtMs(iso: string | undefined): number | undefined {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? ms : undefined;
}

/** The push's collapse key: a newer reminder replaces an unread older one, and nothing else. */
export function unpaidReminderCollapseKey(roomId: string): string {
  return `unlock:${roomId}`;
}

// ---------------------------------------------------------------------------
// Claims: `unpaid_reminders_sent` in Postgres, an in-process map in memory mode.
// ---------------------------------------------------------------------------

/** Memory mode: `roomId|slot` → claim time (ms). Shared by every scheduler in the process. */
const memoryClaims = new Map<string, number>();

function claimKey(roomId: string, slot: UnpaidReminderSlot): string {
  return `${roomId}|${slot}`;
}

export type UnpaidReminderClaim = "claimed" | "taken" | "paid" | "room_gone";

/**
 * Claim one reminder before sending it, if the race still needs it. "claimed": this caller won and
 * must send. "taken": another tick or instance already did. "paid": the race was paid (or is no
 * longer `unpaid`, or its creator bought a pass the webhook could not attach, R25) after it was
 * listed, so nothing is claimed. "room_gone": the room row was deleted after the room was listed,
 * so there is nothing to remind.
 *
 * Postgres reads the stored room and inserts the claim in one statement: the row goes in only while
 * the room is `unpaid` with no billing grant for it, active or revoked, and no unattached grant
 * from its creator (`createdByUserId`, else the first member). Memory mode checks the grants (the
 * room's, and `creatorId`'s unattached ones) right before it claims; every way a room is paid
 * records a grant first.
 */
export async function claimUnpaidReminder(
  roomId: string,
  slot: UnpaidReminderSlot,
  nowMs: number,
  creatorId?: string
): Promise<UnpaidReminderClaim> {
  const pool = getPersistencePool();
  if (!pool) {
    if ((await listRoomIdsWithBillingGrants([roomId])).has(roomId) || (await userHasUnattachedBillingGrant(creatorId))) {
      return "paid";
    }
    // No await between the check and the set: two ticks in this process can't both claim.
    const key = claimKey(roomId, slot);
    if (memoryClaims.has(key)) {
      return "taken";
    }
    memoryClaims.set(key, nowMs);
    return "claimed";
  }
  // The statement reads billing_grants (migration 0019; created here too when missing).
  await ensureBillingStoreReady();
  try {
    const result = await pool.query<{ claimed: boolean; due: boolean; room_exists: boolean }>(
      `WITH due AS (
         SELECT r.id FROM race_rooms_json r
         WHERE r.id = $1::text
           AND r.payload->'entitlement'->>'status' = 'unpaid'
           AND NOT EXISTS (SELECT 1 FROM billing_grants g WHERE g.room_id = r.id)
           AND NOT ${creatorHasUnattachedGrantSql("r")}
       ),
       claimed AS (
         INSERT INTO unpaid_reminders_sent (room_id, slot, claimed_at)
         SELECT id, $2::text, $3::timestamptz FROM due
         ON CONFLICT (room_id, slot) DO NOTHING
         RETURNING room_id
       )
       SELECT EXISTS (SELECT 1 FROM claimed) AS claimed,
              EXISTS (SELECT 1 FROM due) AS due,
              EXISTS (SELECT 1 FROM race_rooms_json WHERE id = $1::text) AS room_exists`,
      [roomId, slot, new Date(nowMs).toISOString()]
    );
    const row = result.rows[0];
    if (row?.claimed) {
      return "claimed";
    }
    if (row?.due) {
      // Still due, and the insert met another claim's row.
      return "taken";
    }
    return row?.room_exists ? "paid" : "room_gone";
  } catch (err) {
    // The room row was deleted after this statement's snapshot: the claim's foreign key refuses it.
    if ((err as { code?: unknown }).code === "23503") {
      return "room_gone";
    }
    throw err;
  }
}

/**
 * When each of `roomIds` had its `expiry_1d` reminder claimed (ms); rooms without one are absent.
 * With `db`, the query runs on that connection (the sweeper's transaction holding the room's row
 * lock), so it never waits for a second pool connection while holding the lock.
 */
export async function listUnpaidFinalReminderClaimTimes(
  roomIds: readonly string[],
  db?: PersistenceQueryable
): Promise<Map<string, number>> {
  const claimed = new Map<string, number>();
  if (roomIds.length === 0) {
    return claimed;
  }
  const pool = getPersistencePool();
  if (!pool) {
    for (const roomId of roomIds) {
      const at = memoryClaims.get(claimKey(roomId, "expiry_1d"));
      if (at !== undefined) {
        claimed.set(roomId, at);
      }
    }
    return claimed;
  }
  const queryable: PersistenceQueryable = db ?? pool;
  const result = await queryable.query<{ room_id: string; claimed_at: Date }>(
    `SELECT room_id, claimed_at FROM unpaid_reminders_sent
     WHERE slot = 'expiry_1d' AND room_id = ANY($1::text[])`,
    [[...roomIds]]
  );
  for (const row of result.rows) {
    claimed.set(row.room_id, row.claimed_at.getTime());
  }
  return claimed;
}

/** When the room's `expiry_1d` reminder was claimed (ms), if it was (see {@link listUnpaidFinalReminderClaimTimes}). */
export async function unpaidFinalReminderClaimedAt(
  roomId: string,
  db?: PersistenceQueryable
): Promise<number | undefined> {
  return (await listUnpaidFinalReminderClaimTimes([roomId], db)).get(roomId);
}

/** Memory mode's claims for a room, as the listing returns them. Postgres reads them in the listing's query. */
export function memoryUnpaidReminderClaims(roomId: string): UnpaidReminderClaims {
  const claims: UnpaidReminderClaims = {};
  for (const slot of ["expiry_7d", "expiry_1d", "race_soon"] as const) {
    const at = memoryClaims.get(claimKey(roomId, slot));
    if (at !== undefined) {
      claims[slot] = new Date(at).toISOString();
    }
  }
  return claims;
}

/**
 * Room deletion, memory mode: drop the room's claims. Postgres rows go with the room row
 * (ON DELETE CASCADE), so this is a no-op there.
 */
export function forgetUnpaidRemindersForRoom(roomId: string): void {
  const prefix = `${roomId}|`;
  for (const key of [...memoryClaims.keys()]) {
    if (key.startsWith(prefix)) {
      memoryClaims.delete(key);
    }
  }
}

export type UnpaidReminderClaimRow = { slot: UnpaidReminderSlot; claimedAt: string };

/** The claims stored for a room, by slot name. For tests and support. */
export async function listUnpaidReminderClaims(roomId: string): Promise<UnpaidReminderClaimRow[]> {
  const pool = getPersistencePool();
  if (!pool) {
    return Object.entries(memoryUnpaidReminderClaims(roomId))
      .map(([slot, claimedAt]) => ({ slot: slot as UnpaidReminderSlot, claimedAt: claimedAt as string }))
      .sort((a, b) => a.slot.localeCompare(b.slot));
  }
  const result = await pool.query<{ slot: UnpaidReminderSlot; claimed_at: Date }>(
    `SELECT slot, claimed_at FROM unpaid_reminders_sent WHERE room_id = $1 ORDER BY slot ASC`,
    [roomId]
  );
  return result.rows.map((row) => ({ slot: row.slot, claimedAt: row.claimed_at.toISOString() }));
}

/** Test-only: clear memory mode's claims. No-op against Postgres. */
export function _resetUnpaidRemindersForTests(): void {
  memoryClaims.clear();
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/** The room fields the scheduler reads (the Postgres listing selects only these). */
export type UnpaidReminderRoom = RaceRoomReminderFields;

/**
 * Unpaid, never-paid rooms that may have a reminder due: created at or before `createdBeforeMs`
 * and without an `expiry_1d` claim, or starting after `startsAfterMs` and at most
 * `startsAtOrBeforeMs` without a `race_soon` claim (raceRooms.ts `listUnpaidRaceRoomsForReminders`).
 * The scheduler decides from the parsed times.
 */
export type UnpaidReminderListRooms = (
  createdBeforeMs: number,
  startsAfterMs: number,
  startsAtOrBeforeMs: number
) => Promise<UnpaidReminderRoom[]>;

export type UnpaidReminderResult =
  /** Claimed and handed to the push transport. */
  | "sent"
  /** Claimed, but the creator has no push device: the slot counts as passed. */
  | "no_devices"
  /** Claimed, but the race has no creator on its roster to tell: the slot counts as passed. */
  | "no_runner"
  /** Claimed, but the push transport threw. Not retried: a duplicate is worse than a miss. */
  | "dispatch_failed"
  /** Another tick or instance claimed it. */
  | "already_sent"
  /**
   * Paid (a billing grant, a status other than `unpaid`, or an unattached grant from its creator)
   * after it was listed: nothing claimed, nothing sent.
   */
  | "paid"
  /** The room was deleted after it was listed. */
  | "room_gone"
  /** Reading devices or claiming threw; logged, and the next tick tries again. */
  | "error";

export type UnpaidReminderOutcome = {
  roomId: string;
  slot: UnpaidReminderSlot;
  result: UnpaidReminderResult;
  /** Devices the transport reported delivered, when sent. */
  delivered?: number;
};

export type UnpaidReminderSchedulerOptions = {
  listRooms: UnpaidReminderListRooms;
  log: Pick<FastifyBaseLogger, "info" | "warn">;
  /** Clock (ms). Default `Date.now`. */
  now?: () => number;
  /** Tick interval (ms). Default {@link UNPAID_REMINDER_INTERVAL_MS}. */
  intervalMs?: number;
  /** Don't tick on start; the first tick waits one interval. */
  skipFirstRun?: boolean;
  /** Longest `stop()` waits for a tick in flight (ms). Default 5 s. */
  stopWaitMs?: number;
};

export type UnpaidReminderScheduler = {
  /** One pass at `now()`. Never throws. Returns an outcome per reminder it tried. */
  tick(): Promise<UnpaidReminderOutcome[]>;
  /** Start the timer (idempotent). Ticks right away unless `skipFirstRun`. */
  start(): void;
  /**
   * Stop the timer, end a pass in flight at the next room boundary, and wait (up to `stopWaitMs`)
   * for it.
   */
  stop(): Promise<void>;
  readonly running: boolean;
};

export function createUnpaidRaceReminderScheduler(opts: UnpaidReminderSchedulerOptions): UnpaidReminderScheduler {
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? UNPAID_REMINDER_INTERVAL_MS;
  const stopWaitMs = opts.stopWaitMs ?? DEFAULT_STOP_WAIT_MS;
  const log = opts.log;
  let handle: ReturnType<typeof setInterval> | undefined;
  let timerTick: Promise<unknown> | undefined;
  /** Set by `stop()`: a pass in flight ends before its next room. */
  let stopping = false;

  const outcomeOf = (
    room: UnpaidReminderRoom,
    slot: UnpaidReminderSlot,
    result: UnpaidReminderResult,
    delivered?: number
  ): UnpaidReminderOutcome => ({
    roomId: room.id,
    slot,
    result,
    ...(delivered !== undefined ? { delivered } : {})
  });

  /** Claim one slot. Undefined when this pass won it (and must send it); else why not. */
  async function claimOne(
    room: UnpaidReminderRoom,
    slot: UnpaidReminderSlot,
    atMs: number
  ): Promise<UnpaidReminderOutcome | undefined> {
    let claim: UnpaidReminderClaim;
    try {
      claim = await claimUnpaidReminder(room.id, slot, atMs, room.creatorId);
    } catch (err) {
      log.warn({ err, unpaidReminder: { roomId: room.id, slot } }, "unpaid_reminder_check_failed");
      return outcomeOf(room, slot, "error");
    }
    switch (claim) {
      case "claimed":
        room.claims[slot] = new Date(atMs).toISOString();
        return undefined;
      case "taken":
        return outcomeOf(room, slot, "already_sent");
      case "paid":
        return outcomeOf(room, slot, "paid");
      case "room_gone":
        return outcomeOf(room, slot, "room_gone");
    }
  }

  /** Push a slot this pass claimed at `sendAtMs` to the creator. */
  async function sendOne(
    room: UnpaidReminderRoom,
    slot: UnpaidReminderSlot,
    devices: ChatPushDeviceRecord[] | undefined,
    sendAtMs: number
  ): Promise<UnpaidReminderOutcome> {
    if (devices === undefined) {
      return outcomeOf(room, slot, "no_runner");
    }
    if (devices.length === 0) {
      return outcomeOf(room, slot, "no_devices");
    }
    const startMs = Date.parse(room.raceStartAt ?? "");
    const untilMs =
      slot === "race_soon"
        ? startMs
        : unpaidRaceExpiresAtMs(room.createdAt, claimedAtMs(room.claims.expiry_1d)) ?? sendAtMs;
    const copy = unpaidRaceReminderCopy(slot, room.name, untilMs, sendAtMs);
    try {
      const dispatch = await dispatchChatPush({
        kind: "unlock",
        roomId: room.id,
        title: copy.title,
        body: copy.body,
        targets: devicesToTargets(devices),
        // A phone offline for days never shows a stale count; race_soon is moot after the gun.
        expiresAtMs: slot === "race_soon" ? startMs : sendAtMs + UNPAID_EXPIRY_REMINDER_PUSH_TTL_MS,
        collapseKey: unpaidReminderCollapseKey(room.id)
      });
      // Metadata only: never tokens, names or user ids.
      log.info(
        {
          unpaidReminder: {
            roomId: room.id,
            slot,
            delivered: dispatch.delivered,
            attempts: dispatch.attempts,
            failures: dispatch.failures.length
          }
        },
        "unpaid_reminder_sent"
      );
      return outcomeOf(room, slot, "sent", dispatch.delivered);
    } catch (err) {
      log.warn({ err, unpaidReminder: { roomId: room.id, slot } }, "unpaid_reminder_dispatch_failed");
      return outcomeOf(room, slot, "dispatch_failed");
    }
  }

  /**
   * The room's due reminders, judged on a fresh clock (earlier rooms' pushes take time). Outcomes
   * come back in claim order.
   */
  async function remind(room: UnpaidReminderRoom): Promise<UnpaidReminderOutcome[]> {
    if (room.entitlementStatus !== "unpaid") {
      return [];
    }
    // A copy: the claims made below are this pass's, not the listing's.
    const current: UnpaidReminderRoom = { ...room, claims: { ...room.claims } };
    const firstAtMs = now();
    const expiryDue = unpaidExpiryReminderDue(current, firstAtMs);
    const due: UnpaidReminderSlot[] = [
      ...(expiryDue ? [expiryDue] : []),
      ...(unpaidRaceSoonReminderDue(current, firstAtMs) ? (["race_soon"] as const) : [])
    ];
    if (due.length === 0) {
      return [];
    }
    // Undefined: nobody on the roster to tell (the claim is still made).
    let devices: ChatPushDeviceRecord[] | undefined;
    if (current.creatorId && current.creatorIsMember) {
      try {
        devices = await listChatPushDevicesForUsers([current.creatorId]);
      } catch (err) {
        // Nothing claimed: the next tick tries again.
        log.warn({ err, unpaidReminder: { roomId: room.id } }, "unpaid_reminder_check_failed");
        return due.map((slot) => ({ roomId: room.id, slot, result: "error" }));
      }
    }
    // Each slot this pass tries, in claim order; `outcome` is set once it is settled.
    const steps: { slot: UnpaidReminderSlot; atMs: number; outcome: UnpaidReminderOutcome | undefined }[] = [];
    // The expiry slot is claimed first: once `expiry_1d` is claimed, the race's expiry time moves to
    // a day after it, which decides whether a race starting within that day still gets `race_soon`.
    const expiryAtMs = now();
    const expiryNow = unpaidExpiryReminderDue(current, expiryAtMs);
    if (expiryNow) {
      const refused = await claimOne(current, expiryNow, expiryAtMs);
      if (refused?.result === "paid" || refused?.result === "room_gone") {
        // Paid or deleted since it was listed: `race_soon` would be refused the same way.
        return [refused];
      }
      steps.push({ slot: expiryNow, atMs: expiryAtMs, outcome: refused });
    }
    const soonAtMs = now();
    if (unpaidRaceSoonReminderDue(current, soonAtMs)) {
      steps.push({ slot: "race_soon", atMs: soonAtMs, outcome: await claimOne(current, "race_soon", soonAtMs) });
    }
    // Sent in the reverse of the claim order. Both share the collapse key, so a phone keeps the
    // last one it gets: with `expiry_1d` and `race_soon` together, that is the deletion warning.
    for (const step of [...steps].reverse()) {
      step.outcome ??= await sendOne(current, step.slot, devices, step.atMs);
    }
    return steps.map((step) => step.outcome as UnpaidReminderOutcome);
  }

  async function tick(): Promise<UnpaidReminderOutcome[]> {
    const nowMs = now();
    let rooms: UnpaidReminderRoom[];
    try {
      rooms = await opts.listRooms(
        nowMs - UNPAID_REMINDER_7D_AFTER_MS,
        nowMs,
        nowMs + UNPAID_REMINDER_RACE_SOON_BEFORE_MS
      );
    } catch (err) {
      log.warn({ err, unpaidReminders: { phase: "list_rooms" } }, "unpaid_reminder_pass_failed");
      return [];
    }
    const outcomes: UnpaidReminderOutcome[] = [];
    for (const room of rooms) {
      // A deploy's shutdown ends the pass here, between rooms, never between a claim and its push.
      if (stopping) {
        break;
      }
      try {
        outcomes.push(...(await remind(room)));
      } catch (err) {
        // A malformed room (a stored payload missing fields) must not stop the others.
        log.warn({ err, unpaidReminder: { roomId: room?.id } }, "unpaid_reminder_check_failed");
      }
    }
    if (outcomes.length > 0) {
      const count = (result: UnpaidReminderResult) => outcomes.filter((o) => o.result === result).length;
      log.info(
        {
          unpaidReminders: {
            listed: rooms.length,
            sent: count("sent"),
            noDevices: count("no_devices"),
            noRunner: count("no_runner"),
            alreadySent: count("already_sent"),
            paid: count("paid"),
            failed: count("error") + count("dispatch_failed")
          }
        },
        "unpaid_reminder_pass"
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
        log.warn({ err, unpaidReminders: { phase: "tick" } }, "unpaid_reminder_pass_failed");
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
          // event loop drain while shutdown is still pending on a hung tick.
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
