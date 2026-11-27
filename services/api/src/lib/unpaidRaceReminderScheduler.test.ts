/**
 * Unpaid-race reminder pushes (runner and crew onboarding): `expiry_7d`, `expiry_1d` and
 * `race_soon`, each once, to the race's creator only, and the 30-day sweeper waiting a day after
 * `expiry_1d`. The scheduler runs on a fake clock against the real API and store (memory here,
 * Postgres in CI's api-postgres-integration job, where the claim is the `unpaid_reminders_sent`
 * row and the listing is SQL). Rooms are created through the routes, then backdated.
 *
 * Every tick would see every unpaid room in the store (Postgres runs share one database), so the
 * schedulers here list only the test's own rooms, and assertions filter pushes by room.
 */
import test, { after } from "node:test";

// The scheduler unrefs its interval so it never holds a server process open. On Node 20 that lets
// the event loop go empty while a test awaits a tick, and the runner cancels the rest of the file.
// Keep the loop alive for this file; each test's own timeout still catches a real hang.
const keepAlive = setInterval(() => undefined, 1_000);
after(() => clearInterval(keepAlive));
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { RaceRoom } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { applyBillingGrant } from "../routes/billingRoutes.js";
import {
  getRaceRoom,
  listUnpaidRaceRoomsCreatedBefore,
  listUnpaidRaceRoomsForReminders,
  removeMemberForAccountDeletion,
  setRaceRoomCreatedAtForTests
} from "../routes/raceRooms.js";
import { _resetChatPersistenceForTests } from "./chatPersistence.js";
import {
  resetChatPushTransport,
  setChatPushTransport,
  type ChatPushDispatchInput,
  type ChatPushTransport
} from "./chatPushDispatch.js";
import {
  apnsTransport,
  fcmTransport,
  platformRoutingTransport,
  type ApnsRequest,
  type FcmFetch
} from "./chatPushTransports.js";
import { deleteRaceRoomAndData } from "./raceRoomDeletion.js";
import { isRoomPersistenceEnabled, loadRaceRoom } from "./roomPersistence.js";
import { createUnpaidRaceExpiryScheduler } from "./unpaidRaceExpiryScheduler.js";
import {
  _resetUnpaidRemindersForTests,
  claimUnpaidReminder,
  createUnpaidRaceReminderScheduler,
  isPastFinalReminderGrace,
  listUnpaidReminderClaims,
  UNPAID_REMINDER_INTERVAL_MS,
  unpaidExpiryReminderDue,
  unpaidRaceExpiresAtMs,
  unpaidRaceSoonReminderDue,
  type UnpaidReminderOutcome,
  type UnpaidReminderRoom
} from "./unpaidRaceReminderScheduler.js";
import { fakeApnsToken } from "./testPushTokens.js";

/** The token a test phone registers: APNs-shaped hex on iOS, an FCM-style string on Android. */
function pushToken(user: string, platform: "ios" | "android"): string {
  return platform === "ios" ? fakeApnsToken(`tok-${user}`) : `tok-${user}-${platform}`;
}

type App = ReturnType<typeof buildApp>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
/** Whole seconds, so stored times round-trip exactly. */
const wholeSecond = (ms: number) => Math.floor(ms / 1000) * 1000;
const uid = (name: string) => `${name}-${randomUUID().slice(0, 8)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function auth(app: App, sub: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} })}` };
}

type LogLine = { payload: unknown; msg: string };

function recordingLog() {
  const infos: LogLine[] = [];
  const warns: LogLine[] = [];
  return {
    infos,
    warns,
    info: ((payload: unknown, msg?: string) => {
      infos.push({ payload, msg: String(msg ?? "") });
    }) as never,
    warn: ((payload: unknown, msg?: string) => {
      warns.push({ payload, msg: String(msg ?? "") });
    }) as never
  };
}

async function withApp(run: (app: App) => Promise<void>): Promise<void> {
  _resetChatPersistenceForTests();
  _resetUnpaidRemindersForTests();
  resetChatPushTransport();
  const app = buildApp();
  await app.ready();
  try {
    await run(app);
  } finally {
    resetChatPushTransport();
    await app.close();
  }
}

/** Every push handed to the transport, delivered to every target. */
function capturePushes(): ChatPushDispatchInput[] {
  const sent: ChatPushDispatchInput[] = [];
  setChatPushTransport(async (input) => {
    sent.push(input);
    return { delivered: input.targets.length, attempts: input.targets.length, failures: [], invalidDeviceIds: [] };
  });
  return sent;
}

async function createRace(app: App, runner: string, name = "Unlock 100"): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: runner, name, creatorRole: "athlete" },
    headers: auth(app, runner)
  });
  assert.equal(created.statusCode, 201, created.body);
  return (created.json() as RaceRoom).id;
}

async function setEntitlement(app: App, roomId: string, user: string, status: "paid" | "unpaid" | "expired") {
  const set = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status },
    headers: auth(app, user)
  });
  assert.equal(set.statusCode, 200, set.body);
}

async function setStart(app: App, roomId: string, user: string, startMs: number) {
  const set = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/race-start`,
    payload: { raceStartAt: iso(startMs) },
    headers: auth(app, user)
  });
  assert.equal(set.statusCode, 200, set.body);
}

async function registerDevice(app: App, user: string, platform: "ios" | "android" = "ios") {
  const res = await app.inject({
    method: "POST",
    url: "/chat/push/tokens",
    payload: { deviceId: `dev-${user}-${platform}`, platform, token: pushToken(user, platform) },
    headers: auth(app, user)
  });
  assert.equal(res.statusCode, 201, res.body);
}

/** Crew join a paid race (an unpaid one refuses them with 402). */
async function addCrew(app: App, roomId: string, runner: string, crew: string) {
  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: `${crew}@example.com`, role: "crew_member" },
    headers: auth(app, runner)
  });
  assert.equal(invite.statusCode, 201, invite.body);
  const accept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: (invite.json() as { token: string }).token },
    headers: auth(app, crew)
  });
  assert.equal(accept.statusCode, 200, accept.body);
}

/** An unpaid race for `runner` created at `createdMs`, optionally starting at `startMs`, with a push device. */
async function unpaidRace(
  app: App,
  runner: string,
  createdMs: number | undefined,
  opts: { startMs?: number; name?: string; device?: boolean } = {}
): Promise<string> {
  const roomId = await createRace(app, runner, opts.name);
  if (opts.startMs !== undefined) {
    await setStart(app, roomId, runner, opts.startMs);
  }
  await setRaceRoomCreatedAtForTests(roomId, createdMs === undefined ? undefined : iso(createdMs));
  if (opts.device !== false) {
    await registerDevice(app, runner);
  }
  return roomId;
}

/** A reminder scheduler at `clock` that lists only `roomIds` (other tests' rooms share the store). */
function reminders(
  clock: { now: number },
  roomIds: readonly string[],
  log = recordingLog(),
  afterListing: () => Promise<void> = async () => {}
) {
  const ours = new Set(roomIds);
  return createUnpaidRaceReminderScheduler({
    listRooms: async (createdBeforeMs, startsAfterMs, startsAtOrBeforeMs) => {
      const rooms = (await listUnpaidRaceRoomsForReminders(createdBeforeMs, startsAfterMs, startsAtOrBeforeMs)).filter(
        (room) => ours.has(room.id)
      );
      await afterListing();
      return rooms;
    },
    log,
    now: () => clock.now,
    skipFirstRun: true
  });
}

/**
 * A gate that opens once `count` callers have reached it: each pass's listing waits for the others,
 * so every pass lists the room before any of them claims it, as two instances listing at once do.
 */
function gate(count: () => number): () => Promise<void> {
  let arrived = 0;
  let open: () => void = () => {};
  let opened = new Promise<void>((resolve) => (open = resolve));
  return async () => {
    arrived += 1;
    const waitFor = opened;
    if (arrived >= count()) {
      arrived = 0;
      open();
      opened = new Promise<void>((resolve) => (open = resolve));
    }
    await waitFor;
  };
}

/** `slot:result` for `roomId`'s outcomes, in order. */
const forRoom = (outcomes: UnpaidReminderOutcome[], roomId: string) =>
  outcomes.filter((o) => o.roomId === roomId).map((o) => `${o.slot}:${o.result}`);

const pushesFor = (pushes: ChatPushDispatchInput[], roomId: string) => pushes.filter((p) => p.roomId === roomId);

const claimsOf = async (roomId: string) =>
  (await listUnpaidReminderClaims(roomId)).map((claim) => `${claim.slot}@${claim.claimedAt}`);

async function readRoom(app: App, roomId: string, user: string): Promise<RaceRoom> {
  const read = await app.inject({ method: "GET", url: `/race-rooms/${roomId}`, headers: auth(app, user) });
  assert.equal(read.statusCode, 200, read.body);
  return (read.json() as { room: RaceRoom }).room;
}

async function mine(app: App, roomId: string, user: string): Promise<RaceRoom | undefined> {
  const read = await app.inject({ method: "GET", url: "/race-rooms/mine", headers: auth(app, user) });
  assert.equal(read.statusCode, 200, read.body);
  return (read.json() as { rooms: RaceRoom[] }).rooms.find((room) => room.id === roomId);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

test("due rules: 7d from day 23, 1d from day 29 (7d skipped then), race_soon from start − 3 days while ahead and before the expiry", () => {
  const created = Date.parse("2026-10-01T08:00:00.000Z");
  const at = (days: number) => created + days * DAY;
  const room = (claims: UnpaidReminderRoom["claims"] = {}, raceStartAt?: string) => ({
    createdAt: iso(created),
    raceStartAt,
    claims
  });
  assert.equal(UNPAID_REMINDER_INTERVAL_MS, 15 * MINUTE);

  assert.equal(unpaidExpiryReminderDue(room(), at(23) - 1), undefined);
  assert.equal(unpaidExpiryReminderDue(room(), at(23)), "expiry_7d");
  assert.equal(unpaidExpiryReminderDue(room(), at(29) - 1), "expiry_7d");
  assert.equal(unpaidExpiryReminderDue(room({ expiry_7d: iso(at(23)) }), at(28)), undefined, "sent once");
  assert.equal(unpaidExpiryReminderDue(room(), at(29)), "expiry_1d", "the more urgent one only");
  assert.equal(unpaidExpiryReminderDue(room(), at(40)), "expiry_1d", "catch-up");
  assert.equal(unpaidExpiryReminderDue(room({ expiry_7d: iso(at(23)) }), at(29)), "expiry_1d");
  assert.equal(unpaidExpiryReminderDue(room({ expiry_1d: iso(at(29)) }), at(29.5)), undefined, "7d never after 1d is due");
  assert.equal(unpaidExpiryReminderDue({ createdAt: undefined, claims: {} }, at(40)), undefined, "no age");
  assert.equal(unpaidExpiryReminderDue({ createdAt: "not a time", claims: {} }, at(40)), undefined);

  const start = at(10);
  assert.equal(unpaidRaceSoonReminderDue(room({}, iso(start)), start - 3 * DAY - 1), false);
  assert.equal(unpaidRaceSoonReminderDue(room({}, iso(start)), start - 3 * DAY), true);
  assert.equal(unpaidRaceSoonReminderDue(room({}, iso(start)), start - 1), true, "catch-up until the gun");
  assert.equal(unpaidRaceSoonReminderDue(room({}, iso(start)), start), false, "not once it started");
  assert.equal(unpaidRaceSoonReminderDue(room({ race_soon: iso(start - 3 * DAY) }, iso(start)), start - DAY), false);
  // The race is deleted on day 30: a start after that gets the expiry reminders, not race_soon.
  assert.equal(unpaidRaceSoonReminderDue(room({}, iso(at(30) - 1)), at(29)), true);
  assert.equal(unpaidRaceSoonReminderDue(room({}, iso(at(30))), at(29)), false);
  // Its 1-day reminder claimed late (a server down) moves the expiry to a day after the claim.
  assert.equal(unpaidRaceSoonReminderDue(room({ expiry_1d: iso(at(31)) }, iso(at(31.5))), at(31)), true);
  // No creation time: never deleted, so any start is before the expiry.
  assert.equal(unpaidRaceSoonReminderDue({ createdAt: undefined, raceStartAt: iso(start), claims: {} }, start - DAY), true);
  assert.equal(unpaidRaceSoonReminderDue(room({}, undefined), start - DAY), false, "no start");
});

test("expiry time: the later of createdAt + 30 days and the 1-day claim + 24 h; none without createdAt", () => {
  const created = Date.parse("2026-10-01T08:00:00.000Z");
  assert.equal(unpaidRaceExpiresAtMs(iso(created), undefined), created + 30 * DAY);
  assert.equal(unpaidRaceExpiresAtMs(iso(created), created + 29 * DAY), created + 30 * DAY);
  assert.equal(unpaidRaceExpiresAtMs(iso(created), created + 40 * DAY), created + 41 * DAY, "catch-up");
  assert.equal(unpaidRaceExpiresAtMs(iso(created), created + 20 * DAY), created + 30 * DAY, "never sooner than 30 days");
  assert.equal(unpaidRaceExpiresAtMs(undefined, created), undefined);
  assert.equal(unpaidRaceExpiresAtMs("garbage", undefined), undefined);
  assert.equal(isPastFinalReminderGrace(undefined, created), false);
  assert.equal(isPastFinalReminderGrace(created, created + DAY - 1), false);
  assert.equal(isPastFinalReminderGrace(created, created + DAY), true);
});

// ---------------------------------------------------------------------------
// Pushes
// ---------------------------------------------------------------------------

test("each slot goes out exactly once, to the creator only: 7d, race_soon, then 1d", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const runner = uid("runner-slots");
    const crew = uid("crew-slots");
    const t0 = wholeSecond(Date.now());
    const created = t0 - 23 * DAY;
    const start = t0 + 5 * DAY;
    // Crew joined while it was paid by hand; set back to unpaid by hand, no billing grant: a race
    // never paid as far as billing knows, with crew on it.
    const roomId = await createRace(app, runner, "Slots 100");
    await setEntitlement(app, roomId, runner, "paid");
    await addCrew(app, roomId, runner, crew);
    await setStart(app, roomId, runner, start);
    await setEntitlement(app, roomId, runner, "unpaid");
    await setRaceRoomCreatedAtForTests(roomId, iso(created));
    await registerDevice(app, runner);
    await registerDevice(app, crew);
    const clock = { now: t0 };
    const log = recordingLog();
    const reminder = reminders(clock, [roomId], log);

    assert.deepEqual(forRoom(await reminder.tick(), roomId), ["expiry_7d:sent"]);
    clock.now = t0 + HOUR;
    assert.deepEqual(forRoom(await reminder.tick(), roomId), [], "sent once");
    clock.now = t0 + 2 * DAY;
    assert.deepEqual(forRoom(await reminder.tick(), roomId), ["race_soon:sent"]);
    clock.now = t0 + 2 * DAY + HOUR;
    assert.deepEqual(forRoom(await reminder.tick(), roomId), []);
    clock.now = t0 + 6 * DAY;
    assert.deepEqual(forRoom(await reminder.tick(), roomId), ["expiry_1d:sent"]);
    for (const later of [6 * DAY + HOUR, 8 * DAY, 40 * DAY]) {
      clock.now = t0 + later;
      assert.deepEqual(forRoom(await reminder.tick(), roomId), [], `nothing more at +${later / HOUR} h`);
    }

    const sent = pushesFor(pushes, roomId);
    assert.deepEqual(
      sent.map((p) => p.body),
      [
        "Your race Slots 100 will be deleted in 7 days. Unlock it to keep your course and plan.",
        "Your race Slots 100 is in 3 days. Unlock it so your crew can follow you.",
        "Your race Slots 100 will be deleted tomorrow. Unlock it to keep your course and plan."
      ]
    );
    for (const push of sent) {
      assert.equal(push.kind, "unlock");
      assert.equal(push.title, "Unlock your race");
      assert.deepEqual(
        push.targets.map((t) => t.userId),
        [runner],
        "the runner gets it, the crew does not"
      );
      assert.equal(push.collapseKey, `unlock:${roomId}`);
      assert.equal(push.messageId, undefined, "clients read messageId as a chat message");
    }
    assert.deepEqual(
      sent.map((p) => p.expiresAtMs),
      [t0 + DAY, start, t0 + 7 * DAY],
      "expiry reminders keep 24 h; race_soon keeps until the start"
    );
    assert.deepEqual((await claimsOf(roomId)).sort(), [
      `expiry_1d@${iso(t0 + 6 * DAY)}`,
      `expiry_7d@${iso(t0)}`,
      `race_soon@${iso(t0 + 2 * DAY)}`
    ]);
    assert.deepEqual(log.warns, []);
  });
});

test("never for a paid, expired, once-paid or deleted race, and nothing more once it is paid", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const t0 = wholeSecond(Date.now());
    const old = t0 - 29.5 * DAY;
    const soon = t0 + DAY;

    const paidRunner = uid("runner-paid");
    const paid = await unpaidRace(app, paidRunner, old, { startMs: soon });
    await setEntitlement(app, paid, paidRunner, "paid");
    const expiredRunner = uid("runner-expired");
    const expired = await unpaidRace(app, expiredRunner, old, { startMs: soon });
    await setEntitlement(app, expired, expiredRunner, "expired");
    // Paid through billing, then refunded: unpaid again, but paid once.
    const refundedRunner = uid("runner-refunded");
    const refunded = await unpaidRace(app, refundedRunner, old, { startMs: soon });
    const grant = {
      transactionId: uid("txn"),
      roomId: refunded,
      productId: "race_pass",
      appUserId: refundedRunner,
      source: "revenuecat" as const
    };
    assert.equal((await applyBillingGrant({ ...grant, status: "active" }, app.log)).room?.entitlement.status, "paid");
    assert.equal((await applyBillingGrant({ ...grant, status: "revoked" }, app.log)).room?.entitlement.status, "unpaid");
    const deleted = await unpaidRace(app, uid("runner-deleted"), old, { startMs: soon });
    assert.equal(await deleteRaceRoomAndData(deleted), "deleted");
    // Warned at day 23, then paid: no more reminders.
    const paysLaterRunner = uid("runner-pays-later");
    const paysLater = await unpaidRace(app, paysLaterRunner, t0 - 23 * DAY);
    const billedLaterRunner = uid("runner-billed-later");
    const billedLater = await unpaidRace(app, billedLaterRunner, t0 - 23 * DAY);

    const ids = [paid, expired, refunded, deleted, paysLater, billedLater];
    const clock = { now: t0 };
    const reminder = reminders(clock, ids);
    const first = await reminder.tick();
    for (const roomId of [paid, expired, refunded, deleted]) {
      assert.deepEqual(forRoom(first, roomId), [], roomId);
    }
    assert.deepEqual(forRoom(first, paysLater), ["expiry_7d:sent"]);
    assert.deepEqual(forRoom(first, billedLater), ["expiry_7d:sent"]);

    await setEntitlement(app, paysLater, paysLaterRunner, "paid");
    await applyBillingGrant(
      {
        transactionId: uid("txn"),
        roomId: billedLater,
        productId: "race_pass",
        appUserId: billedLaterRunner,
        source: "revenuecat",
        status: "active"
      },
      app.log
    );
    for (const later of [6 * DAY, 10 * DAY]) {
      clock.now = t0 + later;
      const outcomes = await reminder.tick();
      for (const roomId of ids) {
        assert.deepEqual(forRoom(outcomes, roomId), [], `+${later / DAY} d`);
      }
    }
    for (const roomId of [paid, expired, refunded, deleted]) {
      assert.equal(pushesFor(pushes, roomId).length, 0);
      assert.deepEqual(await listUnpaidReminderClaims(roomId), []);
    }
    assert.equal(pushesFor(pushes, paysLater).length, 1);
    assert.equal(pushesFor(pushes, billedLater).length, 1);

    if (isRoomPersistenceEnabled()) {
      // Deleted between listing and claiming: the claim's foreign key refuses it.
      assert.equal(await claimUnpaidReminder(deleted, "expiry_1d", t0), "room_gone");
    }
  });
});

test("a race paid while the pass works through earlier rooms gets no reminder: the claim re-checks it", async () => {
  await withApp(async (app) => {
    const pushes: ChatPushDispatchInput[] = [];
    const t0 = wholeSecond(Date.now());
    const first = await unpaidRace(app, uid("runner-first"), t0 - 29.5 * DAY, { name: "First" });
    const paysRunner = uid("runner-pays-mid-pass");
    const pays = await unpaidRace(app, paysRunner, t0 - 29.5 * DAY, { name: "Pays" });
    const buysRunner = uid("runner-buys-unattached-mid-pass");
    const buys = await unpaidRace(app, buysRunner, t0 - 29.5 * DAY, { name: "Buys" });
    // While the first room's push is out, one runner's purchase is applied to their race, and the
    // other's is stored with no room (no crewcue_room_id attribute: R25).
    setChatPushTransport(async (input) => {
      pushes.push(input);
      if (input.roomId === first) {
        const purchase = { productId: "race_pass", source: "revenuecat" as const, status: "active" as const };
        await applyBillingGrant({ ...purchase, transactionId: uid("txn"), roomId: pays, appUserId: paysRunner }, app.log);
        await applyBillingGrant({ ...purchase, transactionId: uid("txn"), roomId: null, appUserId: buysRunner }, app.log);
      }
      return { delivered: input.targets.length, attempts: input.targets.length, failures: [], invalidDeviceIds: [] };
    });
    const log = recordingLog();
    const order = [first, pays, buys];
    const reminder = createUnpaidRaceReminderScheduler({
      // All three listed unpaid, the first one first.
      listRooms: async (...range) =>
        (await listUnpaidRaceRoomsForReminders(...range))
          .filter((room) => order.includes(room.id))
          .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
      log,
      now: () => t0,
      skipFirstRun: true
    });

    const outcomes = await reminder.tick();
    assert.deepEqual(forRoom(outcomes, first), ["expiry_1d:sent"]);
    assert.deepEqual(forRoom(outcomes, pays), ["expiry_1d:paid"], "paid after the listing: no claim");
    assert.deepEqual(forRoom(outcomes, buys), ["expiry_1d:paid"], "bought with no room after the listing");
    assert.equal((await getRaceRoom(pays))?.entitlement.status, "paid");
    for (const roomId of [pays, buys]) {
      assert.equal(pushesFor(pushes, roomId).length, 0, "never told a paid race will be deleted");
      assert.deepEqual(await listUnpaidReminderClaims(roomId), []);
    }
    const pass = log.infos.find((line) => line.msg === "unpaid_reminder_pass")?.payload as {
      unpaidReminders: { paid: number };
    };
    assert.equal(pass.unpaidReminders.paid, 2, "counted in the pass log");
    // The claim itself, asked directly: refused for both.
    assert.equal(await claimUnpaidReminder(pays, "race_soon", t0, paysRunner), "paid");
    assert.equal(await claimUnpaidReminder(buys, "race_soon", t0, buysRunner), "paid");
    assert.equal(await claimUnpaidReminder(first, "race_soon", t0), "claimed", "an unpaid race is still claimed");
  });
});

test("a creator with a purchase stored with no room (R25) gets no reminder and no unpaidExpiresAt on any race they created", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const t0 = wholeSecond(Date.now());
    const buyer = uid("runner-unattached");
    const old = await unpaidRace(app, buyer, t0 - 29.5 * DAY, { name: "Bought" });
    const soon = await unpaidRace(app, buyer, t0 - DAY, { startMs: t0 + 2 * DAY });
    const otherRunner = uid("runner-not-the-buyer");
    const other = await unpaidRace(app, otherRunner, t0 - 29.5 * DAY);
    assert.ok((await readRoom(app, old, buyer)).unpaidExpiresAt, "a deletion time before the purchase");
    // The store charged the runner, but the webhook found no room to apply it to.
    await applyBillingGrant(
      {
        transactionId: uid("txn"),
        roomId: null,
        productId: "race_pass",
        appUserId: buyer,
        source: "revenuecat",
        status: "active"
      },
      app.log
    );
    const ids = [old, soon, other];
    const listed = (await listUnpaidRaceRoomsForReminders(t0 - 23 * DAY, t0, t0 + 3 * DAY)).filter((room) =>
      ids.includes(room.id)
    );
    assert.deepEqual(listed.map((room) => room.id), [other], "neither of the buyer's races is a candidate");

    const clock = { now: t0 };
    const reminder = reminders(clock, ids);
    const outcomes = await reminder.tick();
    assert.deepEqual(forRoom(outcomes, other), ["expiry_1d:sent"]);
    for (const roomId of [old, soon]) {
      assert.deepEqual(forRoom(outcomes, roomId), []);
      assert.equal(pushesFor(pushes, roomId).length, 0);
      assert.equal((await readRoom(app, roomId, buyer)).unpaidExpiresAt, undefined, "the sweeper keeps it");
    }
    assert.equal((await mine(app, old, buyer))?.unpaidExpiresAt, undefined);
    assert.equal((await readRoom(app, other, otherRunner)).unpaidExpiresAt, iso(t0 + DAY), "another runner's race still expires");
  });
});

test("a race past day 29 gets the 1-day reminder only: the 7-day one is skipped", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const t0 = wholeSecond(Date.now());
    const roomId = await unpaidRace(app, uid("runner-skip-7d"), t0 - 29.5 * DAY, { name: "Skip 50" });
    const clock = { now: t0 };
    const reminder = reminders(clock, [roomId]);
    assert.deepEqual(forRoom(await reminder.tick(), roomId), ["expiry_1d:sent"]);
    clock.now = t0 + HOUR;
    assert.deepEqual(forRoom(await reminder.tick(), roomId), []);
    assert.deepEqual(await claimsOf(roomId), [`expiry_1d@${iso(t0)}`]);
    assert.deepEqual(
      pushesFor(pushes, roomId).map((p) => p.body),
      ["Your race Skip 50 will be deleted tomorrow. Unlock it to keep your course and plan."]
    );
  });
});

test("race_soon: only while the start is ahead and before the race's expiry; catch-up included", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const t0 = wholeSecond(Date.now());
    // In 2 days, created yesterday.
    const inTwoDays = await unpaidRace(app, uid("runner-soon"), t0 - DAY, { startMs: t0 + 2 * DAY });
    // Deleted (day 30) before it starts: the expiry reminders, never race_soon.
    const afterExpiry = await unpaidRace(app, uid("runner-after-expiry"), t0 - 28 * DAY, { startMs: t0 + 2.5 * DAY });
    // Already started.
    const started = await unpaidRace(app, uid("runner-started"), t0 - DAY, { startMs: t0 - HOUR });
    // Four days out: not yet.
    const later = await unpaidRace(app, uid("runner-later"), t0 - DAY, { startMs: t0 + 4 * DAY });
    // Start − 3 days long gone (a server down, or a race set up late): sent now.
    const catchUp = await unpaidRace(app, uid("runner-catch-up-soon"), t0 - DAY, { startMs: t0 + 2 * HOUR });
    // Day 29.5, starting in 12 hours: the 1-day reminder moves the expiry to a day after it, past the start.
    const both = await unpaidRace(app, uid("runner-both"), t0 - 29.5 * DAY, { startMs: t0 + 12 * HOUR, name: "Both" });
    // No creation time: never deleted, so race_soon applies.
    const undated = await unpaidRace(app, uid("runner-undated"), undefined, { startMs: t0 + DAY });
    // Day 24, starting in 2 days (before day 30): the 7-day reminder and race_soon in one tick.
    const sevenAndSoon = await unpaidRace(app, uid("runner-7d-and-soon"), t0 - 24 * DAY, {
      startMs: t0 + 2 * DAY,
      name: "Seven"
    });
    const ids = [inTwoDays, afterExpiry, started, later, catchUp, both, undated, sevenAndSoon];
    const clock = { now: t0 };
    const reminder = reminders(clock, ids);

    let outcomes = await reminder.tick();
    assert.deepEqual(forRoom(outcomes, inTwoDays), ["race_soon:sent"]);
    assert.deepEqual(forRoom(outcomes, afterExpiry), ["expiry_7d:sent"]);
    assert.deepEqual(forRoom(outcomes, started), []);
    assert.deepEqual(forRoom(outcomes, later), []);
    assert.deepEqual(forRoom(outcomes, catchUp), ["race_soon:sent"]);
    assert.deepEqual(forRoom(outcomes, both), ["expiry_1d:sent", "race_soon:sent"]);
    assert.deepEqual(forRoom(outcomes, undated), ["race_soon:sent"]);
    assert.deepEqual(forRoom(outcomes, sevenAndSoon), ["expiry_7d:sent", "race_soon:sent"]);

    clock.now = t0 + DAY;
    outcomes = await reminder.tick();
    assert.deepEqual(forRoom(outcomes, later), ["race_soon:sent"]);
    assert.deepEqual(forRoom(outcomes, afterExpiry), ["expiry_1d:sent"], "still no race_soon: deleted first");
    for (const roomId of [inTwoDays, started, catchUp, both, undated, sevenAndSoon]) {
      assert.deepEqual(forRoom(outcomes, roomId), []);
    }
    clock.now = t0 + 2.4 * DAY;
    outcomes = await reminder.tick();
    for (const roomId of ids) {
      assert.deepEqual(forRoom(outcomes, roomId), []);
    }

    assert.match(pushesFor(pushes, inTwoDays)[0]?.body ?? "", / is in 2 days\. Unlock it so your crew can follow you\.$/);
    assert.equal(pushesFor(pushes, inTwoDays)[0]?.expiresAtMs, t0 + 2 * DAY, "dropped at the start");
    assert.match(pushesFor(pushes, catchUp)[0]?.body ?? "", / is in 1 day\./);
    assert.match(pushesFor(pushes, later)[0]?.body ?? "", / is in 3 days\./);
    // Claimed 1-day reminder first (the outcomes above), but sent last: both share one collapse
    // key, so the phone keeps the last push, and that must be the deletion warning.
    assert.deepEqual(
      pushesFor(pushes, both).map((p) => p.body.replace(/^Your race Both /, "")),
      [
        "is in 1 day. Unlock it so your crew can follow you.",
        "will be deleted tomorrow. Unlock it to keep your course and plan."
      ],
      "race_soon first, then the 1-day reminder, one collapse key"
    );
    assert.equal(new Set(pushesFor(pushes, both).map((p) => p.collapseKey)).size, 1);
    assert.equal(
      pushesFor(pushes, both).at(-1)?.body,
      "Your race Both will be deleted tomorrow. Unlock it to keep your course and plan.",
      "the deletion warning is the one left on the phone"
    );
    // The 7-day reminder with race_soon: sent in claim order, so the race two days off is the one
    // left on the phone (the delete is 6 days away, the race 2).
    assert.deepEqual(
      pushesFor(pushes, sevenAndSoon).map((p) => p.body.replace(/^Your race Seven /, "")),
      [
        "will be deleted in 6 days. Unlock it to keep your course and plan.",
        "is in 2 days. Unlock it so your crew can follow you."
      ],
      "the 7-day reminder first, then race_soon, one collapse key"
    );
    assert.equal(new Set(pushesFor(pushes, sevenAndSoon).map((p) => p.collapseKey)).size, 1);
    assert.equal(pushesFor(pushes, started).length + pushesFor(pushes, afterExpiry).filter((p) => /is in/.test(p.body)).length, 0);
  });
});

test("a race paid or deleted between its 1-day claim and its race_soon claim gets neither push; the 1-day claim stays", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const t0 = wholeSecond(Date.now());
    // Day 29.5, starting in 12 hours: expiry_1d is claimed, then race_soon is due in the same pass.
    const paysRunner = uid("runner-pays-between-claims");
    const pays = await unpaidRace(app, paysRunner, t0 - 29.5 * DAY, { startMs: t0 + 12 * HOUR, name: "Pays" });
    const goneRunner = uid("runner-gone-between-claims");
    const gone = await unpaidRace(app, goneRunner, t0 - 29.5 * DAY, { startMs: t0 + 12 * HOUR, name: "Gone" });
    const control = await unpaidRace(app, uid("runner-control-between-claims"), t0 - 29.5 * DAY, {
      startMs: t0 + 12 * HOUR,
      name: "Control"
    });
    const ids = [pays, gone, control];
    const claimed: string[] = [];
    const log = recordingLog();
    const reminder = createUnpaidRaceReminderScheduler({
      // In this order, so the claims below read in order.
      listRooms: async (...range) =>
        (await listUnpaidRaceRoomsForReminders(...range))
          .filter((room) => ids.includes(room.id))
          .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
      // The real claim; right after `expiry_1d` is won, the runner's purchase is applied to the
      // race (`pays`), or the room is reported deleted before race_soon's claim (`gone`).
      claim: async (roomId, slot, atMs, creatorId) => {
        if (roomId === gone && slot === "race_soon") {
          claimed.push(`${slot}:room_gone`);
          return "room_gone";
        }
        const result = await claimUnpaidReminder(roomId, slot, atMs, creatorId);
        if (roomId === pays && slot === "expiry_1d" && result === "claimed") {
          await applyBillingGrant(
            {
              transactionId: uid("txn"),
              roomId: pays,
              productId: "race_pass",
              appUserId: paysRunner,
              source: "revenuecat",
              status: "active"
            },
            app.log
          );
        }
        if (roomId !== control) {
          claimed.push(`${slot}:${result}`);
        }
        return result;
      },
      log,
      now: () => t0,
      skipFirstRun: true
    });

    const outcomes = await reminder.tick();
    assert.deepEqual(claimed, ["expiry_1d:claimed", "race_soon:paid", "expiry_1d:claimed", "race_soon:room_gone"]);
    assert.deepEqual(forRoom(outcomes, pays), ["expiry_1d:paid", "race_soon:paid"]);
    assert.deepEqual(forRoom(outcomes, gone), ["expiry_1d:room_gone", "race_soon:room_gone"]);
    assert.deepEqual(forRoom(outcomes, control), ["expiry_1d:sent", "race_soon:sent"], "an unpaid race still gets both");
    for (const roomId of [pays, gone]) {
      assert.equal(pushesFor(pushes, roomId).length, 0, "never told a race just paid will be deleted tomorrow");
      assert.deepEqual(await claimsOf(roomId), [`expiry_1d@${iso(t0)}`], "the 1-day claim made still counts");
    }
    assert.equal(pushesFor(pushes, control).length, 2);
    assert.equal((await getRaceRoom(pays))?.entitlement.status, "paid");
    const pass = log.infos.find((line) => line.msg === "unpaid_reminder_pass")?.payload as {
      unpaidReminders: { sent: number; paid: number };
    };
    assert.equal(pass.unpaidReminders.sent, 2);
    assert.equal(pass.unpaidReminders.paid, 2);

    // Nothing is retried later: the paid race is no longer a candidate, the other's claim stands.
    assert.deepEqual(forRoom(await reminder.tick(), pays), []);
    assert.equal(pushesFor(pushes, pays).length, 0);
  });
});

test("catch-up: a 40-day-old race gets its 1-day reminder first, and the sweeper keeps it until 24 h after that claim, then deletes it", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const runner = uid("runner-catch-up");
    const t0 = wholeSecond(Date.now());
    const created = t0 - 40 * DAY;
    const roomId = await unpaidRace(app, runner, created, { name: "Old 50k" });
    const clock = { now: t0 };
    const reminder = reminders(clock, [roomId]);
    const sweep = createUnpaidRaceExpiryScheduler({
      listRooms: async (createdBeforeMs, limit, claimedBeforeMs) =>
        (await listUnpaidRaceRoomsCreatedBefore(createdBeforeMs, 10_000, claimedBeforeMs))
          .filter((room) => room.id === roomId)
          .slice(0, limit),
      log: recordingLog(),
      now: () => clock.now,
      skipFirstRun: true
    });
    // Handed to the sweeper directly, past its listing: the condition under the lock still decides.
    const handed = createUnpaidRaceExpiryScheduler({
      listRooms: async () => [{ id: roomId, entitlementStatus: "unpaid", createdAt: iso(created) }],
      log: recordingLog(),
      now: () => clock.now,
      skipFirstRun: true
    });

    // The sweeper is on before any reminder went out: a 40-day-old race is not deleted unwarned.
    assert.deepEqual(await sweep.tick(), [], "not a candidate");
    assert.deepEqual(await handed.tick(), [{ roomId, result: "kept" }]);
    assert.equal((await readRoom(app, roomId, runner)).unpaidExpiresAt, iso(created + 30 * DAY));

    assert.deepEqual(forRoom(await reminder.tick(), roomId), ["expiry_1d:sent"], "1d first, never 7d");
    assert.deepEqual(
      pushesFor(pushes, roomId).map((p) => p.body),
      ["Your race Old 50k will be deleted tomorrow. Unlock it to keep your course and plan."]
    );
    assert.deepEqual(await claimsOf(roomId), [`expiry_1d@${iso(t0)}`]);
    assert.equal((await readRoom(app, roomId, runner)).unpaidExpiresAt, iso(t0 + DAY), "a day after the warning");
    assert.equal((await mine(app, roomId, runner))?.unpaidExpiresAt, iso(t0 + DAY));

    for (const at of [t0, t0 + 12 * HOUR, t0 + DAY - MINUTE]) {
      clock.now = at;
      assert.deepEqual(await sweep.tick(), [], `kept at +${(at - t0) / MINUTE} min`);
      assert.deepEqual(await handed.tick(), [{ roomId, result: "kept" }]);
    }
    assert.ok(await getRaceRoom(roomId));

    clock.now = t0 + DAY;
    assert.deepEqual(await sweep.tick(), [{ roomId, result: "deleted" }]);
    assert.equal(await getRaceRoom(roomId), undefined);
    assert.deepEqual(await listUnpaidReminderClaims(roomId), [], "its claims went with it");
    const read = await app.inject({ method: "GET", url: `/race-rooms/${roomId}`, headers: auth(app, runner) });
    assert.equal(read.statusCode, 404, read.body);
    assert.deepEqual(forRoom(await reminder.tick(), roomId), []);
    assert.equal(pushesFor(pushes, roomId).length, 1);
  });
});

test("two schedulers ticking at once against the same store send each reminder once", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const t0 = wholeSecond(Date.now());
    const roomId = await unpaidRace(app, uid("runner-two-instances"), t0 - 23 * DAY);
    const clock = { now: t0 };
    // Every pass lists before any claims (on Postgres one could otherwise list after the other's
    // claim and skip the slot quietly): the claim alone must pick the sender.
    let passes = 2;
    const listed = gate(() => passes);
    const a = reminders(clock, [roomId], recordingLog(), listed);
    const b = reminders(clock, [roomId], recordingLog(), listed);

    let both = (await Promise.all([a.tick(), b.tick()])).flat();
    assert.deepEqual(forRoom(both, roomId).sort(), ["expiry_7d:already_sent", "expiry_7d:sent"]);
    clock.now = t0 + 6 * DAY;
    passes = 3;
    both = (await Promise.all([a.tick(), b.tick(), a.tick()])).flat();
    assert.deepEqual(forRoom(both, roomId).sort(), [
      "expiry_1d:already_sent",
      "expiry_1d:already_sent",
      "expiry_1d:sent"
    ]);
    assert.equal(pushesFor(pushes, roomId).length, 2);

    // The claim itself, raced ten ways on one key: one winner.
    const claims = await Promise.all(Array.from({ length: 10 }, () => claimUnpaidReminder(roomId, "race_soon", t0)));
    assert.equal(claims.filter((c) => c === "claimed").length, 1);
    assert.equal(claims.filter((c) => c === "taken").length, 9);
  });
});

test("a runner with no push device, or a creator off the roster, still gets the claim: the slot counts as passed", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const t0 = wholeSecond(Date.now());
    const runner = uid("runner-no-device");
    const roomId = await unpaidRace(app, runner, t0 - 29.5 * DAY, { device: false });

    // A team manager set the race up for a runner who never joined, then left (account deletion
    // drops their membership): nobody on the roster to tell, and the runner named by `athleteId`
    // is not the creator.
    const owner = uid("owner-left");
    const athlete = uid("athlete-never-joined");
    const created = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: { teamId: "team-1", athleteId: athlete, name: "Set up for the runner", creatorRole: "team_manager" },
      headers: auth(app, owner)
    });
    assert.equal(created.statusCode, 201, created.body);
    const ownerless = (created.json() as RaceRoom).id;
    await setRaceRoomCreatedAtForTests(ownerless, iso(t0 - 29.5 * DAY));
    assert.equal(await removeMemberForAccountDeletion(ownerless, owner, undefined, app.log), true);
    await registerDevice(app, owner);
    await registerDevice(app, athlete);

    const clock = { now: t0 };
    const reminder = reminders(clock, [roomId, ownerless]);
    const outcomes = await reminder.tick();
    assert.deepEqual(forRoom(outcomes, roomId), ["expiry_1d:no_devices"]);
    assert.deepEqual(forRoom(outcomes, ownerless), ["expiry_1d:no_runner"]);
    assert.deepEqual(await claimsOf(roomId), [`expiry_1d@${iso(t0)}`]);
    assert.deepEqual(await claimsOf(ownerless), [`expiry_1d@${iso(t0)}`]);
    assert.equal(pushesFor(pushes, roomId).length + pushesFor(pushes, ownerless).length, 0);

    // A device registered later doesn't bring the passed slot back.
    await registerDevice(app, runner);
    clock.now = t0 + HOUR;
    assert.deepEqual(forRoom(await reminder.tick(), roomId), []);
    assert.equal(pushesFor(pushes, roomId).length, 0);

    // And the sweeper may delete both a day after the claim.
    const listed = await listUnpaidRaceRoomsCreatedBefore(t0 + DAY - 30 * DAY, 10_000, t0);
    assert.deepEqual(
      listed.filter((room) => room.id === roomId || room.id === ownerless).map((room) => room.id).sort(),
      [roomId, ownerless].sort()
    );
    await deleteRaceRoomAndData(roomId);
    await deleteRaceRoomAndData(ownerless);
  });
});

test("on the wire: type unlock, the roomId, a 24 h expiry and an unlock collapse key", async () => {
  await withApp(async (app) => {
    const ecKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({
      type: "pkcs8",
      format: "pem"
    }) as string;
    const rsaKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
      type: "pkcs8",
      format: "pem"
    }) as string;
    const apnsCalls: Parameters<ApnsRequest>[0][] = [];
    const fcmBodies: string[] = [];
    const fetchImpl: FcmFetch = async (url, init) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return { status: 200, text: async () => JSON.stringify({ access_token: "at", expires_in: 3600 }) };
      }
      fcmBodies.push(init.body);
      return { status: 200, text: async () => "{}" };
    };
    const fallback: ChatPushTransport = async () => ({ delivered: 0, attempts: 0, failures: [], invalidDeviceIds: [] });
    const runner = uid("runner-wire");
    const t0 = wholeSecond(Date.now());
    const clock = { now: t0 };
    setChatPushTransport(
      platformRoutingTransport({
        ios: apnsTransport(
          { keyP8: ecKey, keyId: "KEY123", teamId: "TEAM456", topic: "com.crewcue.ios" },
          async (req) => {
            apnsCalls.push(req);
            return { status: 200, body: "" };
          },
          { sleep: async () => undefined, now: () => clock.now }
        ),
        android: fcmTransport(
          { project_id: "crewcue-test", client_email: "push@crewcue-test.iam.gserviceaccount.com", private_key: rsaKey },
          fetchImpl,
          { sleep: async () => undefined, now: () => clock.now }
        ),
        fallback
      })
    );
    const roomId = await unpaidRace(app, runner, t0 - 23 * DAY, { device: false, name: "Wire 100" });
    await registerDevice(app, runner, "ios");
    await registerDevice(app, runner, "android");

    const outcome = (await reminders(clock, [roomId]).tick()).find((o) => o.roomId === roomId);
    assert.equal(outcome?.result, "sent");
    assert.equal(outcome?.delivered, 2);

    const apns = apnsCalls.find((c) => c.path === `/3/device/${pushToken(runner, "ios")}`);
    assert.ok(apns, "APNs request for the runner's iPhone");
    const apnsPayload = JSON.parse(apns.body) as {
      aps: { alert: { title: string; body: string } };
      type: string;
      roomId: string;
      messageId?: string;
    };
    assert.equal(apnsPayload.type, "unlock");
    assert.equal(apnsPayload.roomId, roomId);
    assert.equal(apnsPayload.aps.alert.title, "Unlock your race");
    assert.equal(
      apnsPayload.aps.alert.body,
      "Your race Wire 100 will be deleted in 7 days. Unlock it to keep your course and plan."
    );
    assert.equal(apnsPayload.messageId, undefined);
    assert.equal(apns.headers["apns-expiration"], String((t0 + DAY) / 1000), "a phone offline for days never shows it");
    assert.equal(apns.headers["apns-collapse-id"], `unlock:${roomId}`, "not the room id chat and schedule use");

    const fcm = fcmBodies
      .map(
        (body) =>
          JSON.parse(body) as {
            message: {
              token: string;
              data: Record<string, string>;
              notification: { title: string };
              android: { ttl?: string; notification: { tag: string } };
            };
          }
      )
      .find((m) => m.message.token === pushToken(runner, "android"));
    assert.ok(fcm, "FCM message for the runner's Android phone");
    assert.equal(fcm.message.data.type, "unlock");
    assert.equal(fcm.message.data.roomId, roomId);
    assert.equal(fcm.message.notification.title, "Unlock your race");
    assert.equal(fcm.message.android.ttl, `${DAY / 1000}s`);
    assert.equal(fcm.message.android.notification.tag, `unlock:${roomId}`, "a chat push can't replace it in the tray");
  });
});

test("a push transport failure is claimed, logged once and not retried", async () => {
  await withApp(async (app) => {
    let calls = 0;
    const t0 = wholeSecond(Date.now());
    const roomId = await unpaidRace(app, uid("runner-dispatch-fails"), t0 - 29.5 * DAY);
    setChatPushTransport(async (input) => {
      calls += input.roomId === roomId ? 1 : 0;
      throw new Error("apns down");
    });
    const log = recordingLog();
    const clock = { now: t0 };
    const reminder = reminders(clock, [roomId], log);
    assert.deepEqual(forRoom(await reminder.tick(), roomId), ["expiry_1d:dispatch_failed"]);
    clock.now = t0 + HOUR;
    assert.deepEqual(forRoom(await reminder.tick(), roomId), []);
    assert.equal(calls, 1);
    assert.deepEqual(await claimsOf(roomId), [`expiry_1d@${iso(t0)}`], "the sweeper still waits a day from it");
    assert.ok(log.warns.some((w) => w.msg === "unpaid_reminder_dispatch_failed"));
    assert.equal(JSON.stringify(log.warns).includes("tok-"), false, "never a token in the log");
  });
});

// ---------------------------------------------------------------------------
// unpaidExpiresAt
// ---------------------------------------------------------------------------

test("unpaidExpiresAt: createdAt + 30 days, then a day after the 1-day reminder; absent once paid, once-paid or undated, and never stored", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-expires-at");
    const t0 = wholeSecond(Date.now());
    const fresh = await unpaidRace(app, runner, t0 - DAY);
    const warnedLate = await unpaidRace(app, runner, t0 - 35 * DAY);
    const undatedRunner = uid("runner-expires-undated");
    const undated = await unpaidRace(app, undatedRunner, undefined);
    const paidRunner = uid("runner-expires-paid");
    const paid = await unpaidRace(app, paidRunner, t0 - DAY);
    await setEntitlement(app, paid, paidRunner, "paid");
    const refundedRunner = uid("runner-expires-refunded");
    const refunded = await unpaidRace(app, refundedRunner, t0 - DAY);
    const grant = {
      transactionId: uid("txn"),
      roomId: refunded,
      productId: "race_pass",
      appUserId: refundedRunner,
      source: "revenuecat" as const
    };
    await applyBillingGrant({ ...grant, status: "active" }, app.log);
    await applyBillingGrant({ ...grant, status: "revoked" }, app.log);

    assert.equal((await readRoom(app, fresh, runner)).unpaidExpiresAt, iso(t0 + 29 * DAY));
    assert.equal((await mine(app, fresh, runner))?.unpaidExpiresAt, iso(t0 + 29 * DAY));
    // Warned five days late (a server down): deleted a day after the warning, not on day 30.
    assert.equal(await claimUnpaidReminder(warnedLate, "expiry_1d", t0 - HOUR), "claimed");
    assert.equal((await readRoom(app, warnedLate, runner)).unpaidExpiresAt, iso(t0 - HOUR + DAY));
    assert.equal((await mine(app, warnedLate, runner))?.unpaidExpiresAt, iso(t0 - HOUR + DAY));

    assert.equal((await readRoom(app, undated, undatedRunner)).unpaidExpiresAt, undefined, "never expires");
    assert.equal((await readRoom(app, paid, paidRunner)).unpaidExpiresAt, undefined);
    assert.equal((await mine(app, paid, paidRunner))?.unpaidExpiresAt, undefined);
    const refundedRoom = await readRoom(app, refunded, refundedRunner);
    assert.equal(refundedRoom.entitlement.status, "unpaid");
    assert.equal(refundedRoom.unpaidExpiresAt, undefined, "paid once: never deleted");
    assert.equal((await mine(app, refunded, refundedRunner))?.unpaidExpiresAt, undefined);

    // Computed for the response only: the stored room and the instance's copy never carry it.
    for (const roomId of [fresh, warnedLate]) {
      assert.equal((await getRaceRoom(roomId))?.unpaidExpiresAt, undefined);
      if (isRoomPersistenceEnabled()) {
        assert.equal((await loadRaceRoom(roomId))?.unpaidExpiresAt, undefined);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Listing and lifecycle
// ---------------------------------------------------------------------------

test("candidates: the slim fields, past day 23 without a 1-day claim, or starting within 3 days without race_soon; never paid", async () => {
  await withApp(async (app) => {
    const t0 = wholeSecond(Date.now());
    const runner = uid("runner-candidates");
    const old = await unpaidRace(app, runner, t0 - 25 * DAY, { name: "Old" });
    const warned = await unpaidRace(app, runner, t0 - 30 * DAY);
    assert.equal(await claimUnpaidReminder(warned, "expiry_1d", t0), "claimed");
    const young = await unpaidRace(app, runner, t0 - DAY);
    const soon = await unpaidRace(app, uid("runner-candidates-soon"), t0 - DAY, { startMs: t0 + 2 * DAY });
    const soonClaimed = await unpaidRace(app, uid("runner-candidates-soon-claimed"), t0 - DAY, { startMs: t0 + 2 * DAY });
    assert.equal(await claimUnpaidReminder(soonClaimed, "race_soon", t0), "claimed");
    const paidRunner = uid("runner-candidates-paid");
    const paid = await unpaidRace(app, paidRunner, t0 - 25 * DAY, { startMs: t0 + DAY });
    await setEntitlement(app, paid, paidRunner, "paid");
    const ours = new Set([old, warned, young, soon, soonClaimed, paid]);

    const listed = (await listUnpaidRaceRoomsForReminders(t0 - 23 * DAY, t0, t0 + 3 * DAY)).filter((room) =>
      ours.has(room.id)
    );
    assert.deepEqual(listed.map((room) => room.id).sort(), [old, soon].sort());
    const oldRoom = listed.find((room) => room.id === old);
    assert.deepEqual(oldRoom, {
      id: old,
      entitlementStatus: "unpaid",
      createdAt: iso(t0 - 25 * DAY),
      raceStartAt: undefined,
      creatorId: runner,
      creatorIsMember: true,
      name: "Old",
      claims: {}
    });
    assert.equal(listed.find((room) => room.id === soon)?.raceStartAt, iso(t0 + 2 * DAY));

    // Its 7-day claim comes back with it, so a tick skips it without a write.
    assert.equal(await claimUnpaidReminder(old, "expiry_7d", t0), "claimed");
    const again = (await listUnpaidRaceRoomsForReminders(t0 - 23 * DAY, t0, t0 + 3 * DAY)).find((room) => room.id === old);
    assert.deepEqual(again?.claims, { expiry_7d: iso(t0) });
  });
});

test("stop ends a pass at a room boundary: the reminder in flight is sent, the next room is not started", async () => {
  await withApp(async (app) => {
    const t0 = wholeSecond(Date.now());
    const rooms = [
      await unpaidRace(app, uid("runner-stop-a"), t0 - 23 * DAY),
      await unpaidRace(app, uid("runner-stop-b"), t0 - 23 * DAY),
      await unpaidRace(app, uid("runner-stop-c"), t0 - 23 * DAY)
    ];
    const sent: string[] = [];
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    setChatPushTransport(async (input) => {
      sent.push(input.roomId);
      if (sent.length === 1) {
        entered();
        await opened;
      }
      return { delivered: input.targets.length, attempts: 1, failures: [], invalidDeviceIds: [] };
    });
    const ours = new Set(rooms);
    const scheduler = createUnpaidRaceReminderScheduler({
      listRooms: async (...range) => (await listUnpaidRaceRoomsForReminders(...range)).filter((room) => ours.has(room.id)),
      log: recordingLog(),
      now: () => t0,
      intervalMs: 60 * MINUTE,
      stopWaitMs: 2_000
    });
    scheduler.start();
    await reached;
    const stopped = scheduler.stop();
    open();
    await stopped;
    assert.equal(sent.length, 1, "the push in flight finished; no other room was started");
    const claimed = await Promise.all(rooms.map(async (roomId) => (await listUnpaidReminderClaims(roomId)).length));
    assert.deepEqual(claimed.sort(), [0, 0, 1]);

    // Started again, the next pass sends the rest.
    scheduler.start();
    const deadline = Date.now() + 2000;
    while (sent.length < 3 && Date.now() < deadline) {
      await sleep(5);
    }
    await scheduler.stop();
    assert.deepEqual([...sent].sort(), [...rooms].sort());
  });
});

test("a failing listing is logged and the tick returns nothing; a malformed room doesn't stop the pass", async () => {
  await withApp(async (app) => {
    const log = recordingLog();
    const failing = createUnpaidRaceReminderScheduler({
      listRooms: async () => {
        throw new Error("database unavailable");
      },
      log,
      skipFirstRun: true
    });
    assert.deepEqual(await failing.tick(), []);
    assert.deepEqual(
      log.warns.map((line) => line.msg),
      ["unpaid_reminder_pass_failed"]
    );

    const pushes = capturePushes();
    const t0 = wholeSecond(Date.now());
    const roomId = await unpaidRace(app, uid("runner-after-malformed"), t0 - 23 * DAY);
    const [good] = (await listUnpaidRaceRoomsForReminders(t0 - 23 * DAY, t0, t0 + 3 * DAY)).filter(
      (room) => room.id === roomId
    );
    assert.ok(good);
    const malformedLog = recordingLog();
    const outcomes = await createUnpaidRaceReminderScheduler({
      listRooms: async () => [null as never, { ...good, claims: undefined as never, createdAt: "garbage" }, good],
      log: malformedLog,
      now: () => t0,
      skipFirstRun: true
    }).tick();
    assert.deepEqual(forRoom(outcomes, roomId), ["expiry_7d:sent"]);
    assert.equal(pushesFor(pushes, roomId).length, 1);
    assert.deepEqual(
      malformedLog.warns.map((line) => line.msg),
      ["unpaid_reminder_check_failed"]
    );
  });
});

// Waits on events, not the wall clock, so a busy machine can't fail it. A scheduler that never
// ticks, or a stop that waits on the hung tick, never settles; the test timeout reports that.
test("the scheduler ticks on its interval from start and stops on stop; stop doesn't wait on a hung tick past its bound", { timeout: 60_000 }, async () => {
  let calls = 0;
  let tickedThrice: () => void = () => undefined;
  const threeTicks = new Promise<void>((resolve) => (tickedThrice = resolve));
  const ticking = createUnpaidRaceReminderScheduler({
    listRooms: async () => {
      calls += 1;
      if (calls === 3) tickedThrice();
      return [];
    },
    log: recordingLog(),
    intervalMs: 5
  });
  assert.equal(ticking.running, false);
  ticking.start();
  assert.equal(ticking.running, true);
  await threeTicks;
  assert.ok(calls >= 3, `ticked ${calls} times`);
  await ticking.stop();
  assert.equal(ticking.running, false);
  const afterStop = calls;
  await sleep(30);
  assert.equal(calls, afterStop, "no tick after stop");

  let markListed: () => void = () => undefined;
  const listed = new Promise<void>((resolve) => (markListed = resolve));
  const hung = createUnpaidRaceReminderScheduler({
    listRooms: () => {
      markListed();
      return new Promise(() => undefined);
    },
    log: recordingLog(),
    stopWaitMs: 20
  });
  hung.start();
  await listed; // the first tick runs on start
  // The tick never settles, so this returns only because stop gives up after stopWaitMs.
  await hung.stop();
  assert.equal(hung.running, false);
});
