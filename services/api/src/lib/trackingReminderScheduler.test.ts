/**
 * Tracking reminder pushes at T-45 and T-5 (runner and crew onboarding). The scheduler runs on a
 * fake clock against the real API: rooms, entitlement, race start, pings and push devices go
 * through the routes, and the real store answers (memory here, Postgres in CI's
 * api-postgres-integration job, where the claim is the `tracking_reminders_sent` row).
 *
 * Pings are judged against the real server clock, so race starts are set relative to `Date.now()`
 * and only the scheduler's clock is faked. Every tick sees every room in the store, so assertions
 * filter outcomes and pushes by the test's own room.
 */
import test, { after } from "node:test";

// The scheduler unrefs its interval so it never holds a server process open. On Node 20 that lets
// the event loop go empty while a test awaits a tick, and the runner cancels the rest of the file.
// Keep the loop alive for this file; each test's own timeout still catches a real hang.
const keepAlive = setInterval(() => undefined, 1_000);
after(() => clearInterval(keepAlive));
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { RaceRoom } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import {
  deleteRaceRoomRecord,
  listRaceRoomsStartingBetween,
  setRaceRoomStatusForTests
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
import { isRoomPersistenceEnabled } from "./roomPersistence.js";
import { load50kCourseWithAids } from "./testCourseRouteLayer.js";
import {
  _resetTrackingRemindersForTests,
  attachTrackingReminderScheduler,
  claimTrackingReminder,
  createTrackingReminderScheduler,
  listTrackingReminderClaims,
  pruneTrackingReminders,
  trackingReminderCopy,
  trackingReminderSlotAt,
  TRACKING_REMINDER_RETENTION_MS,
  type TrackingReminderOutcome
} from "./trackingReminderScheduler.js";

type App = ReturnType<typeof buildApp>;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** The 50k fixture's start line. */
const START_LINE = { latitude: 39.15, longitude: -120.25 };

const iso = (ms: number) => new Date(ms).toISOString();
/** Whole seconds, so stored times round-trip exactly. */
const wholeSecond = (ms: number) => Math.floor(ms / 1000) * 1000;
const uid = (name: string) => `${name}-${randomUUID().slice(0, 8)}`;

function auth(app: App, sub: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} })}` };
}

type Warn = { payload: unknown; msg: string };

function recordingLog() {
  const warns: Warn[] = [];
  return {
    warns,
    info: (() => undefined) as never,
    warn: ((payload: unknown, msg?: string) => {
      warns.push({ payload, msg: String(msg ?? "") });
    }) as never
  };
}

async function withApp(run: (app: App) => Promise<void>): Promise<void> {
  _resetChatPersistenceForTests();
  _resetTrackingRemindersForTests();
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

/**
 * A race for `runner` on the 50k fixture starting at `raceStartMs`, set up while unpaid (the
 * runner's onboarding), then given `entitlement`. The start is sent without milliseconds, as some
 * clients do, so the stored string is not in `toISOString` form.
 */
async function race(
  app: App,
  runner: string,
  raceStartMs: number,
  entitlement: "paid" | "unpaid" | "expired" = "paid"
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: runner, name: "Reminder 50k", creatorRole: "athlete" },
    headers: auth(app, runner)
  });
  assert.equal(created.statusCode, 201, created.body);
  const roomId = (created.json() as RaceRoom).id;
  const fixture = load50kCourseWithAids();
  const course = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: { checkpoints: fixture.checkpoints },
      routeOverlayLayer: fixture.routeOverlayLayer,
      raceStartAt: iso(raceStartMs).replace(/\.\d{3}Z$/, "Z")
    },
    headers: auth(app, runner)
  });
  assert.equal(course.statusCode, 200, course.body);
  if (entitlement !== "unpaid") {
    const set = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/entitlement`,
      payload: { status: entitlement },
      headers: auth(app, runner)
    });
    assert.equal(set.statusCode, 200, set.body);
  }
  return roomId;
}

async function registerDevice(app: App, user: string, platform: "ios" | "android" = "ios") {
  const res = await app.inject({
    method: "POST",
    url: "/chat/push/tokens",
    payload: { deviceId: `dev-${user}-${platform}`, platform, token: `tok-${user}-${platform}` },
    headers: auth(app, user)
  });
  assert.equal(res.statusCode, 201, res.body);
}

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

async function ping(app: App, roomId: string, runner: string, recordedAtMs: number) {
  const res = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: { ...START_LINE, recordedAt: iso(recordedAtMs), uploadIntervalSeconds: 30 },
    headers: auth(app, runner)
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal((res.json() as { decision: string }).decision, "accepted");
}

/** A scheduler on a fake clock. Set `clock.now` before each tick. */
function scheduler(clock: { now: number }, log = recordingLog()) {
  return createTrackingReminderScheduler({
    listRooms: listRaceRoomsStartingBetween,
    log,
    now: () => clock.now,
    skipFirstRun: true
  });
}

/** `slot:result` for `roomId`'s outcomes. */
const forRoom = (outcomes: TrackingReminderOutcome[], roomId: string) =>
  outcomes.filter((o) => o.roomId === roomId).map((o) => `${o.slot}:${o.result}`);

const pushesFor = (pushes: ChatPushDispatchInput[], roomId: string) => pushes.filter((p) => p.roomId === roomId);

test("windows: t45 is [start−45, start−40), t5 is [start−5, start), nothing else", () => {
  const start = Date.parse("2026-11-20T13:00:00.000Z");
  assert.equal(trackingReminderSlotAt(start, start - 45 * MINUTE - 1), undefined);
  assert.equal(trackingReminderSlotAt(start, start - 45 * MINUTE), "t45");
  assert.equal(trackingReminderSlotAt(start, start - 40 * MINUTE - 1), "t45");
  assert.equal(trackingReminderSlotAt(start, start - 40 * MINUTE), undefined);
  assert.equal(trackingReminderSlotAt(start, start - 30 * MINUTE), undefined);
  assert.equal(trackingReminderSlotAt(start, start - 5 * MINUTE - 1), undefined);
  assert.equal(trackingReminderSlotAt(start, start - 5 * MINUTE), "t5");
  assert.equal(trackingReminderSlotAt(start, start - 1), "t5");
  assert.equal(trackingReminderSlotAt(start, start), undefined);
  assert.equal(trackingReminderSlotAt(start, start + MINUTE), undefined);
});

test("copy: relative minutes left, rounded up, never a clock time", () => {
  const start = Date.parse("2026-11-20T13:00:00.000Z");
  assert.deepEqual(trackingReminderCopy(start, start - 45 * MINUTE), {
    title: "Start tracking",
    body: "Your race starts in 45 minutes. Start tracking so your crew can follow you."
  });
  assert.equal(
    trackingReminderCopy(start, start - 5 * MINUTE).body,
    "Your race starts in 5 minutes. Start tracking so your crew can follow you."
  );
  assert.match(trackingReminderCopy(start, start - 44 * MINUTE - 30_000).body, /in 45 minutes\./);
  assert.match(trackingReminderCopy(start, start - 30_000).body, /in 1 minute\./);
  for (const at of [start - 45 * MINUTE, start - 5 * MINUTE, start - 30_000]) {
    const { title, body } = trackingReminderCopy(start, at);
    assert.doesNotMatch(`${title} ${body}`, /\d{1,2}:\d{2}|AM|PM|UTC/);
  }
});

test("a paid race with no pings: one t45 to the runner only, then one t5, nothing after the start", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const runner = uid("runner-t45");
    const crew = uid("crew-t45");
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const roomId = await race(app, runner, start);
    await addCrew(app, roomId, runner, crew);
    await registerDevice(app, runner);
    await registerDevice(app, crew);
    const clock = { now: start - 46 * MINUTE };
    const log = recordingLog();
    const reminders = scheduler(clock, log);

    assert.deepEqual(forRoom(await reminders.tick(), roomId), [], "before the t45 window");

    clock.now = start - 45 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:sent"]);
    let sent = pushesFor(pushes, roomId);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.kind, "tracking");
    assert.equal(sent[0]?.title, "Start tracking");
    assert.equal(sent[0]?.body, "Your race starts in 45 minutes. Start tracking so your crew can follow you.");
    assert.deepEqual(
      sent[0]?.targets.map((t) => t.userId),
      [runner],
      "the runner gets it, the crew does not"
    );
    assert.equal(sent[0]?.expiresAtMs, start - 40 * MINUTE, "t45 expires when its window closes");
    assert.equal(sent[0]?.collapseKey, `tracking:${roomId}`);
    assert.equal(sent[0]?.messageId, undefined, "clients read messageId as a chat message");

    for (const minutesBefore of [44, 41]) {
      clock.now = start - minutesBefore * MINUTE;
      assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:already_sent"], `T-${minutesBefore}`);
    }
    for (const minutesBefore of [40, 30, 6]) {
      clock.now = start - minutesBefore * MINUTE;
      assert.deepEqual(forRoom(await reminders.tick(), roomId), [], `T-${minutesBefore} is outside both windows`);
    }

    clock.now = start - 5 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t5:sent"]);
    clock.now = start - MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t5:already_sent"]);
    for (const at of [start, start + MINUTE, start + 30 * MINUTE]) {
      clock.now = at;
      assert.deepEqual(forRoom(await reminders.tick(), roomId), [], "nothing once the race started");
    }

    sent = pushesFor(pushes, roomId);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]?.kind, "tracking");
    assert.equal(sent[1]?.body, "Your race starts in 5 minutes. Start tracking so your crew can follow you.");
    assert.deepEqual(sent[1]?.targets.map((t) => t.userId), [runner]);
    assert.equal(sent[1]?.expiresAtMs, start, "t5 expires at the gun");
    assert.equal(sent[1]?.collapseKey, `tracking:${roomId}`, "t5 replaces an unread t45");
    assert.deepEqual(
      (await listTrackingReminderClaims(roomId)).map((c) => `${c.slot}@${c.raceStartAt}`).sort(),
      [`t45@${iso(start)}`, `t5@${iso(start)}`]
    );
    assert.deepEqual(log.warns, []);
  });
});

test("a server down through the t45 window sends no t45 and still sends t5", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const runner = uid("runner-down");
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const roomId = await race(app, runner, start);
    await registerDevice(app, runner);
    const clock = { now: start - 30 * MINUTE };
    const reminders = scheduler(clock);

    assert.deepEqual(forRoom(await reminders.tick(), roomId), [], "first tick at T-30: t45's window is gone");
    clock.now = start - 5 * MINUTE + 20_000;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t5:sent"]);
    const sent = pushesFor(pushes, roomId);
    assert.equal(sent.length, 1);
    assert.match(sent[0]?.body ?? "", /in 5 minutes\./);
    assert.deepEqual(
      (await listTrackingReminderClaims(roomId)).map((c) => c.slot),
      ["t5"]
    );
  });
});

test("an accepted ping since T-60 suppresses both, a pre-start test ping included; one before T-60 doesn't", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const pingAt = wholeSecond(Date.now());

    // The ping is exactly at T-60: "at or after" counts it.
    const trackingRunner = uid("runner-tracking");
    const trackingStart = pingAt + 60 * MINUTE;
    const trackingRoom = await race(app, trackingRunner, trackingStart);
    await registerDevice(app, trackingRunner);
    // Before the start, so a pre-start (test) ping: kept out of the projection, but tracking.
    assert.ok(pingAt < trackingStart);
    await ping(app, trackingRoom, trackingRunner, pingAt);

    // The ping is one second before T-60.
    const earlyRunner = uid("runner-early-ping");
    const earlyStart = pingAt + 60 * MINUTE + 1000;
    const earlyRoom = await race(app, earlyRunner, earlyStart);
    await registerDevice(app, earlyRunner);
    await ping(app, earlyRoom, earlyRunner, pingAt);

    const clock = { now: trackingStart - 45 * MINUTE };
    const reminders = scheduler(clock);
    assert.deepEqual(forRoom(await reminders.tick(), trackingRoom), ["t45:tracking"]);
    clock.now = trackingStart - 5 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), trackingRoom), ["t5:tracking"]);
    assert.equal(pushesFor(pushes, trackingRoom).length, 0);
    assert.deepEqual(await listTrackingReminderClaims(trackingRoom), [], "a suppressed reminder is never claimed");

    clock.now = earlyStart - 45 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), earlyRoom), ["t45:sent"]);
    clock.now = earlyStart - 5 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), earlyRoom), ["t5:sent"]);
    assert.equal(pushesFor(pushes, earlyRoom).length, 2);
  });
});

test("a runner who starts tracking after t45 gets no t5", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const runner = uid("runner-late-start");
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const roomId = await race(app, runner, start);
    await registerDevice(app, runner);
    const clock = { now: start - 45 * MINUTE };
    const reminders = scheduler(clock);

    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:sent"]);
    await ping(app, roomId, runner, wholeSecond(Date.now()));
    clock.now = start - 5 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t5:tracking"]);
    assert.equal(pushesFor(pushes, roomId).length, 1);
  });
});

test("unpaid and expired races get nothing", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const unpaidRunner = uid("runner-unpaid");
    const unpaid = await race(app, unpaidRunner, start, "unpaid");
    await registerDevice(app, unpaidRunner);
    const expiredRunner = uid("runner-expired");
    const expired = await race(app, expiredRunner, start, "expired");
    await registerDevice(app, expiredRunner);
    const clock = { now: start - 45 * MINUTE };
    const reminders = scheduler(clock);

    let outcomes = await reminders.tick();
    assert.deepEqual(forRoom(outcomes, unpaid), ["t45:not_paid"]);
    assert.deepEqual(forRoom(outcomes, expired), ["t45:not_paid"]);
    clock.now = start - 5 * MINUTE;
    outcomes = await reminders.tick();
    assert.deepEqual(forRoom(outcomes, unpaid), ["t5:not_paid"]);
    assert.deepEqual(forRoom(outcomes, expired), ["t5:not_paid"]);
    assert.equal(pushesFor(pushes, unpaid).length + pushesFor(pushes, expired).length, 0);
    assert.deepEqual(await listTrackingReminderClaims(unpaid), []);
    assert.deepEqual(await listTrackingReminderClaims(expired), []);
  });
});

test("a room that is not active gets nothing (its pings would be refused)", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const runner = uid("runner-completed");
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const roomId = await race(app, runner, start);
    await registerDevice(app, runner);
    await setRaceRoomStatusForTests(roomId, "completed");
    const reminders = scheduler({ now: start - 45 * MINUTE });
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:not_active"]);
    assert.equal(pushesFor(pushes, roomId).length, 0);
  });
});

test("a runner not on the roster gets nothing until they join", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const owner = uid("owner-not-member");
    const runner = uid("runner-not-member");
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    // A team manager sets the race up for a runner who hasn't joined yet; `athleteId` is theirs.
    const created = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: { teamId: "team-1", athleteId: runner, name: "Set up for the runner", creatorRole: "team_manager" },
      headers: auth(app, owner)
    });
    assert.equal(created.statusCode, 201, created.body);
    const roomId = (created.json() as RaceRoom).id;
    const paid = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/entitlement`,
      payload: { status: "paid" },
      headers: auth(app, owner)
    });
    assert.equal(paid.statusCode, 200, paid.body);
    const started = await app.inject({
      method: "PATCH",
      url: `/race-rooms/${roomId}/race-start`,
      payload: { raceStartAt: iso(start) },
      headers: auth(app, owner)
    });
    assert.equal(started.statusCode, 200, started.body);
    await registerDevice(app, runner);
    await registerDevice(app, owner);
    const clock = { now: start - 45 * MINUTE };
    const reminders = scheduler(clock);

    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:runner_not_member"]);
    assert.equal(pushesFor(pushes, roomId).length, 0);

    await addCrew(app, roomId, owner, runner);
    clock.now = start - 44 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:sent"]);
    assert.deepEqual(pushesFor(pushes, roomId)[0]?.targets.map((t) => t.userId), [runner]);
  });
});

test("a deleted room gets nothing, and its claims go with it", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const clock = { now: start - 45 * MINUTE };
    const reminders = scheduler(clock);

    const goneRunner = uid("runner-deleted");
    const gone = await race(app, goneRunner, start);
    await registerDevice(app, goneRunner);
    await deleteRaceRoomRecord(gone);
    assert.deepEqual(forRoom(await reminders.tick(), gone), []);
    assert.equal(pushesFor(pushes, gone).length, 0);

    const claimedRunner = uid("runner-deleted-after");
    const claimed = await race(app, claimedRunner, start);
    await registerDevice(app, claimedRunner);
    assert.deepEqual(forRoom(await reminders.tick(), claimed), ["t45:sent"]);
    assert.equal((await listTrackingReminderClaims(claimed)).length, 1);
    await deleteRaceRoomRecord(claimed);
    assert.deepEqual(await listTrackingReminderClaims(claimed), []);
    clock.now = start - 5 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), claimed), []);
    assert.equal(pushesFor(pushes, claimed).length, 1);

    if (isRoomPersistenceEnabled()) {
      // Deleted between listing and claiming: the claim's foreign key refuses it.
      assert.equal(await claimTrackingReminder(gone, "t5", start, clock.now), "room_gone");
    }
  });
});

test("moving the start after t45 was sent re-arms t45 for the new start", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const runner = uid("runner-moved");
    const firstStart = wholeSecond(Date.now()) + 50 * MINUTE;
    const roomId = await race(app, runner, firstStart);
    await registerDevice(app, runner);
    const clock = { now: firstStart - 45 * MINUTE };
    const reminders = scheduler(clock);
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:sent"]);

    const movedStart = firstStart + 30 * MINUTE;
    const moved = await app.inject({
      method: "PATCH",
      url: `/race-rooms/${roomId}/race-start`,
      payload: { raceStartAt: iso(movedStart) },
      headers: auth(app, runner)
    });
    assert.equal(moved.statusCode, 200, moved.body);

    clock.now = firstStart - 44 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), [], "the old start's window no longer applies");
    clock.now = movedStart - 45 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:sent"]);
    clock.now = movedStart - 44 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:already_sent"]);

    const sent = pushesFor(pushes, roomId);
    assert.equal(sent.length, 2);
    assert.match(sent[1]?.body ?? "", /in 45 minutes\./);
    assert.deepEqual(
      (await listTrackingReminderClaims(roomId)).map((c) => `${c.slot}@${c.raceStartAt}`),
      [`t45@${iso(firstStart)}`, `t45@${iso(movedStart)}`]
    );
  });
});

test("two schedulers ticking at once against the same store send each reminder once", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const runner = uid("runner-two-instances");
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const roomId = await race(app, runner, start);
    await registerDevice(app, runner);
    const clock = { now: start - 45 * MINUTE };
    const a = scheduler(clock);
    const b = scheduler(clock);

    let both = (await Promise.all([a.tick(), b.tick()])).flat();
    assert.deepEqual(forRoom(both, roomId).sort(), ["t45:already_sent", "t45:sent"]);
    clock.now = start - 5 * MINUTE;
    both = (await Promise.all([a.tick(), b.tick(), a.tick()])).flat();
    assert.deepEqual(forRoom(both, roomId).sort(), ["t5:already_sent", "t5:already_sent", "t5:sent"]);
    assert.equal(pushesFor(pushes, roomId).length, 2);

    // The claim itself, raced ten ways on one key: one winner.
    const otherStart = start + DAY;
    const claims = await Promise.all(
      Array.from({ length: 10 }, () => claimTrackingReminder(roomId, "t45", otherStart, clock.now))
    );
    assert.equal(claims.filter((c) => c === "claimed").length, 1);
    assert.equal(claims.filter((c) => c === "taken").length, 9);
  });
});

test("a runner with no push device is not claimed, so a device registered in the window still gets it", async () => {
  await withApp(async (app) => {
    const pushes = capturePushes();
    const runner = uid("runner-no-device");
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const roomId = await race(app, runner, start);
    const clock = { now: start - 45 * MINUTE };
    const reminders = scheduler(clock);

    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:no_devices"]);
    assert.deepEqual(await listTrackingReminderClaims(roomId), []);
    await registerDevice(app, runner);
    clock.now = start - 43 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:sent"]);
    assert.match(pushesFor(pushes, roomId)[0]?.body ?? "", /in 43 minutes\./);
  });
});

test("on the wire: type tracking, the roomId, an expiry at the window's close and a tracking collapse key", async () => {
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
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const clock = { now: start - 45 * MINUTE };
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
    const roomId = await race(app, runner, start);
    await registerDevice(app, runner, "ios");
    await registerDevice(app, runner, "android");
    const reminders = scheduler(clock);

    const outcome = (await reminders.tick()).find((o) => o.roomId === roomId);
    assert.equal(outcome?.result, "sent");
    assert.equal(outcome?.delivered, 2);

    const apns = apnsCalls.find((c) => c.path === `/3/device/tok-${runner}-ios`);
    assert.ok(apns, "APNs request for the runner's iPhone");
    const apnsPayload = JSON.parse(apns.body) as {
      aps: { alert: { title: string; body: string } };
      type: string;
      roomId: string;
      messageId?: string;
    };
    assert.equal(apnsPayload.type, "tracking");
    assert.equal(apnsPayload.roomId, roomId);
    assert.equal(apnsPayload.aps.alert.title, "Start tracking");
    assert.match(apnsPayload.aps.alert.body, /^Your race starts in 45 minutes\./);
    assert.equal(apnsPayload.messageId, undefined);
    // APNs drops it at T-40 instead of holding it for a phone that is offline (no signal at the start).
    assert.equal(apns.headers["apns-expiration"], String((start - 40 * MINUTE) / 1000));
    assert.equal(apns.headers["apns-collapse-id"], `tracking:${roomId}`, "not the room id chat and schedule use");

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
      .find((m) => m.message.token === `tok-${runner}-android`);
    assert.ok(fcm, "FCM message for the runner's Android phone");
    assert.equal(fcm.message.data.type, "tracking");
    assert.equal(fcm.message.data.roomId, roomId);
    assert.equal(fcm.message.notification.title, "Start tracking");
    assert.equal(fcm.message.android.ttl, "300s", "sent at T-45, dropped at T-40");
    assert.equal(fcm.message.android.notification.tag, `tracking:${roomId}`, "a chat push can't replace it in the tray");
  });
});

test("a push transport failure is logged once and not retried", async () => {
  await withApp(async (app) => {
    let calls = 0;
    setChatPushTransport(async (input) => {
      calls += input.roomId === roomId ? 1 : 0;
      throw new Error("apns down");
    });
    const runner = uid("runner-dispatch-fails");
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const roomId = await race(app, runner, start);
    await registerDevice(app, runner);
    const log = recordingLog();
    const clock = { now: start - 45 * MINUTE };
    const reminders = scheduler(clock, log);

    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:dispatch_failed"]);
    clock.now = start - 44 * MINUTE;
    assert.deepEqual(forRoom(await reminders.tick(), roomId), ["t45:already_sent"]);
    assert.equal(calls, 1);
    assert.ok(log.warns.some((w) => w.msg === "tracking_reminder_dispatch_failed"));
  });
});

/** Two runners' races with the same start, listed first room first, on a scheduler at `clock`. */
async function twoRacesSameStart(app: App, name: string, start: number, clock: { now: number }) {
  const firstRunner = uid(`${name}-first`);
  const secondRunner = uid(`${name}-second`);
  const first = await race(app, firstRunner, start);
  await registerDevice(app, firstRunner);
  const second = await race(app, secondRunner, start);
  await registerDevice(app, secondRunner);
  const reminders = createTrackingReminderScheduler({
    listRooms: async (from, to) =>
      (await listRaceRoomsStartingBetween(from, to))
        .filter((r) => r.id === first || r.id === second)
        .sort((a, b) => Number(b.id === first) - Number(a.id === first)),
    log: recordingLog(),
    now: () => clock.now,
    skipFirstRun: true
  });
  return { first, second, reminders };
}

test("a pass held up by one room's push judges the next room on a fresh clock: nothing after the gun", async () => {
  await withApp(async (app) => {
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const clock = { now: start - 4 * MINUTE - 30_000 };
    const { first, second, reminders } = await twoRacesSameStart(app, "runner-stall-t5", start, clock);
    const sent: ChatPushDispatchInput[] = [];
    setChatPushTransport(async (input) => {
      sent.push(input);
      if (input.roomId === first) {
        // The first room's push stalls until 30 s after the gun.
        await new Promise((resolve) => setImmediate(resolve));
        clock.now = start + 30_000;
      }
      return { delivered: input.targets.length, attempts: 1, failures: [], invalidDeviceIds: [] };
    });

    const outcomes = await reminders.tick();
    assert.deepEqual(
      outcomes.map((o) => `${o.roomId === first ? "first" : "second"}:${o.slot}:${o.result}`),
      ["first:t5:sent", "second:t5:window_closed"]
    );
    assert.deepEqual(
      sent.map((p) => p.roomId),
      [first],
      "the second race is not told it starts in 5 minutes after it started"
    );
    assert.deepEqual(await listTrackingReminderClaims(second), [], "not claimed either");
  });
});

test("a pass held up inside the t45 window words the next room's push from the fresh clock", async () => {
  await withApp(async (app) => {
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const clock = { now: start - 45 * MINUTE };
    const { first, second, reminders } = await twoRacesSameStart(app, "runner-stall-t45", start, clock);
    const sent: ChatPushDispatchInput[] = [];
    setChatPushTransport(async (input) => {
      sent.push(input);
      if (input.roomId === first) {
        clock.now = start - 41 * MINUTE - 30_000;
      }
      return { delivered: input.targets.length, attempts: 1, failures: [], invalidDeviceIds: [] };
    });

    const outcomes = await reminders.tick();
    assert.deepEqual(
      outcomes.map((o) => `${o.roomId === first ? "first" : "second"}:${o.slot}:${o.result}`),
      ["first:t45:sent", "second:t45:sent"]
    );
    assert.match(sent.find((p) => p.roomId === first)?.body ?? "", /in 45 minutes\./);
    assert.match(sent.find((p) => p.roomId === second)?.body ?? "", /in 42 minutes\./, "not a stale 45");
    assert.deepEqual(
      (await listTrackingReminderClaims(second)).map((c) => c.sentAt),
      [iso(start - 41 * MINUTE - 30_000)]
    );
  });
});

test("a tick lists only the two windows' start ranges", async () => {
  const calls: Array<[number, number]> = [];
  const nowMs = Date.parse("2026-11-20T12:00:00.000Z");
  const reminders = createTrackingReminderScheduler({
    listRooms: async (from, to) => {
      calls.push([from, to]);
      return [];
    },
    log: recordingLog(),
    now: () => nowMs,
    skipFirstRun: true
  });
  await reminders.tick();
  assert.deepEqual(calls, [
    [nowMs + 40 * MINUTE, nowMs + 45 * MINUTE],
    [nowMs, nowMs + 5 * MINUTE]
  ]);
});

test("candidates: rooms starting after `from` and at most `to`, with or without milliseconds", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-candidates");
    const start = wholeSecond(Date.now()) + 50 * MINUTE;
    const roomId = await race(app, runner, start, "unpaid");
    const ids = async (from: number, to: number) =>
      (await listRaceRoomsStartingBetween(from, to)).map((r) => r.id).filter((id) => id === roomId);
    assert.deepEqual(await ids(start - 45 * MINUTE, start), [roomId]);
    assert.deepEqual(await ids(start - 1, start + 1), [roomId]);
    assert.deepEqual(await ids(start, start + 45 * MINUTE), [], "a start equal to `from` is excluded");
    assert.deepEqual(await ids(start - 45 * MINUTE, start - 1), []);

    const listed = (await listRaceRoomsStartingBetween(start - 1, start)).find((r) => r.id === roomId);
    assert.ok(listed);
    assert.equal(listed.athleteId, runner);
    assert.equal(listed.status, "active");
    assert.equal(listed.raceStartAt, iso(start).replace(/\.\d{3}Z$/, "Z"));
    assert.equal(listed.entitlement.status, "unpaid");
    assert.deepEqual(
      listed.memberships.map((m) => m.userId),
      [runner]
    );
    if (isRoomPersistenceEnabled()) {
      // Never the whole payload (course GPX, route overlay, map workspace): just what the scheduler reads.
      assert.deepEqual(Object.keys(listed).sort(), [
        "athleteId",
        "entitlement",
        "id",
        "memberships",
        "raceStartAt",
        "status"
      ]);
    }
  });
});

test("claims older than the retention are pruned; newer ones stay", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-prune");
    const now = wholeSecond(Date.now());
    const start = now + 50 * MINUTE;
    const roomId = await race(app, runner, start);
    assert.equal(await claimTrackingReminder(roomId, "t45", start, now - 4 * DAY), "claimed");
    assert.equal(await claimTrackingReminder(roomId, "t5", start, now), "claimed");
    assert.ok((await pruneTrackingReminders(now - TRACKING_REMINDER_RETENTION_MS)) >= 1);
    assert.deepEqual(
      (await listTrackingReminderClaims(roomId)).map((c) => c.slot),
      ["t5"]
    );
  });
});

test("a failing room listing is logged and the tick returns nothing", async () => {
  const log = recordingLog();
  const reminders = createTrackingReminderScheduler({
    listRooms: async () => {
      throw new Error("db down");
    },
    log,
    now: () => Date.now(),
    skipFirstRun: true
  });
  assert.deepEqual(await reminders.tick(), []);
  assert.ok(log.warns.some((w) => w.msg === "tracking_reminder_pass_failed"));
});

test("a malformed stored room is logged and the rest of the pass goes on", async () => {
  const log = recordingLog();
  const start = Date.parse("2026-11-20T13:00:00.000Z");
  const runner = uid("runner-fake-room");
  const rooms = [
    { id: uid("broken-room"), raceStartAt: iso(start) } as unknown as RaceRoom,
    {
      id: uid("fake-room"),
      athleteId: runner,
      status: "active" as const,
      raceStartAt: iso(start),
      entitlement: { status: "paid" as const, lastUpdatedAt: iso(start), source: "manual" as const },
      memberships: [{ userId: runner, role: "athlete" as const, joinedAt: iso(start) }]
    }
  ];
  const reminders = createTrackingReminderScheduler({
    // Both windows' listings return the same rooms: each is still checked once.
    listRooms: async () => rooms,
    log,
    now: () => start - 45 * MINUTE,
    skipFirstRun: true
  });
  const outcomes = await reminders.tick();
  assert.deepEqual(
    outcomes.map((o) => o.result),
    ["no_devices"],
    "the broken room is skipped, the next one still checked"
  );
  assert.ok(log.warns.some((w) => w.msg === "tracking_reminder_check_failed"));
});

// Waits for the ticks, not a wall-clock deadline, so a busy machine can't fail it. A scheduler
// that never ticks never settles; the test timeout reports that.
test("the scheduler starts with the app, ticks on its interval, and stops on app close", { timeout: 60_000 }, async () => {
  const app = Fastify();
  let calls = 0;
  let tickedThrice: () => void = () => undefined;
  const threeTicks = new Promise<void>((resolve) => (tickedThrice = resolve));
  const reminders = attachTrackingReminderScheduler(app, {
    listRooms: async () => {
      calls += 1;
      if (calls === 3) tickedThrice();
      return [];
    },
    log: recordingLog(),
    intervalMs: 5
  });
  assert.equal(reminders.running, false);
  await app.ready();
  assert.equal(reminders.running, true);
  await threeTicks;
  assert.ok(calls >= 3, `ticked ${calls} times`);
  await app.close();
  assert.equal(reminders.running, false);
  const afterClose = calls;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, afterClose, "no tick after close");
});

// Waits on events, not the wall clock, so a busy machine can't fail it. A scheduler that never
// ticks, or a stop that waits on the hung tick, never settles; the test timeout reports that.
test("app close does not wait on a hung tick past its bound", { timeout: 60_000 }, async () => {
  const app = Fastify();
  let markListed: () => void = () => undefined;
  const listed = new Promise<void>((resolve) => (markListed = resolve));
  const reminders = attachTrackingReminderScheduler(app, {
    // Never settles: a store or push call that hangs.
    listRooms: () => {
      markListed();
      return new Promise(() => undefined);
    },
    log: recordingLog(),
    stopWaitMs: 20
  });
  await app.ready();
  await listed; // the first tick runs on start
  // The tick never settles, so this returns only because close gives up after stopWaitMs.
  await app.close();
  assert.equal(reminders.running, false);
});
