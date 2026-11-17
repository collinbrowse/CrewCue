/**
 * Unpaid race expiry: races still `unpaid` 30 days after they were created are deleted with all
 * their data. The sweeper runs against the real API and store (memory here, Postgres in CI's
 * api-postgres-integration job, where the listing, the locked re-read and the delete are SQL).
 *
 * Rooms are created through the routes and then backdated. Every tick sees every room in the
 * store, so assertions filter outcomes by the test's own rooms, and accounts are fresh because
 * Postgres runs share one database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { RaceRoom } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import {
  getProjectionViewForRoom,
  getRaceRoom,
  listUnpaidRaceRoomsCreatedBefore,
  setRaceRoomCreatedAtForTests
} from "../routes/raceRooms.js";
import { listTrackPoints } from "./athletePingTrack.js";
import { listBillingGrantsForRoom, upsertBillingGrant } from "./billingStore.js";
import { listChatMessages } from "./chatMessageStore.js";
import { COURSE_HISTORY_FORMAT_VERSION } from "./courseHistory/format.js";
import { courseHistoryEventId, getCourseHistoryEvents, importCourseHistoryEvents } from "./courseHistory/store.js";
import { listFinishedEfforts, recordFinishedEffort } from "./finishedEffortStore.js";
import { deleteRaceRoomAndData } from "./raceRoomDeletion.js";
import { lineStringRouteOverlayForCheckpoints } from "./testCourseRouteLayer.js";
import { claimTrackingReminder, listTrackingReminderClaims } from "./trackingReminderScheduler.js";
import {
  attachUnpaidRaceExpiryScheduler,
  createUnpaidRaceExpiryScheduler,
  isUnpaidRaceExpired,
  UNPAID_RACE_TTL_MS,
  type UnpaidRaceExpiryListRooms,
  type UnpaidRaceExpiryOutcome
} from "./unpaidRaceExpiryScheduler.js";

type App = ReturnType<typeof buildApp>;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const uid = (name: string) => `${name}-${randomUUID().slice(0, 8)}`;
const iso = (ms: number) => new Date(ms).toISOString();
const daysAgo = (days: number) => iso(Date.now() - days * DAY);

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
  const app = buildApp();
  await app.ready();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

function sweeper(log = recordingLog(), listRooms: UnpaidRaceExpiryListRooms = listUnpaidRaceRoomsCreatedBefore) {
  return createUnpaidRaceExpiryScheduler({ listRooms, log, skipFirstRun: true });
}

const forRoom = (outcomes: UnpaidRaceExpiryOutcome[], roomId: string) =>
  outcomes.filter((o) => o.roomId === roomId).map((o) => o.result);

async function createRace(app: App, runner: string, name = "Expiry 50k"): Promise<RaceRoom> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: runner, name, creatorRole: "athlete" },
    headers: auth(app, runner)
  });
  assert.equal(created.statusCode, 201, created.body);
  return created.json() as RaceRoom;
}

async function setEntitlement(app: App, roomId: string, runner: string, status: "paid" | "unpaid" | "expired") {
  const set = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status, crewTier: "unlimited" },
    headers: auth(app, runner)
  });
  assert.equal(set.statusCode, 200, set.body);
}

/** An unpaid race created `days` ago. */
async function unpaidRace(app: App, runner: string, days: number, status: "paid" | "unpaid" | "expired" = "unpaid") {
  const room = await createRace(app, runner, `${status} ${days}d`);
  if (status !== "unpaid") {
    await setEntitlement(app, room.id, runner, status);
  }
  await setRaceRoomCreatedAtForTests(room.id, daysAgo(days));
  return room;
}

test("expired means still unpaid and at least 30 days old; no creation time never expires", () => {
  const now = Date.parse("2026-11-17T12:00:00.000Z");
  const at = (ms: number) => iso(ms);
  assert.equal(UNPAID_RACE_TTL_MS, 30 * DAY);
  assert.equal(isUnpaidRaceExpired({ entitlementStatus: "unpaid", createdAt: at(now - 30 * DAY) }, now), true);
  assert.equal(isUnpaidRaceExpired({ entitlementStatus: "unpaid", createdAt: at(now - 30 * DAY + 1) }, now), false);
  assert.equal(isUnpaidRaceExpired({ entitlementStatus: "paid", createdAt: at(now - 90 * DAY) }, now), false);
  assert.equal(isUnpaidRaceExpired({ entitlementStatus: "expired", createdAt: at(now - 90 * DAY) }, now), false);
  assert.equal(isUnpaidRaceExpired({ entitlementStatus: "unpaid", createdAt: undefined }, now), false);
  assert.equal(isUnpaidRaceExpired({ entitlementStatus: "unpaid", createdAt: "not a time" }, now), false);
  assert.equal(isUnpaidRaceExpired({ entitlementStatus: undefined, createdAt: at(now - 90 * DAY) }, now), false);
  // A creation time in the future (clock skew) has no age yet.
  assert.equal(isUnpaidRaceExpired({ entitlementStatus: "unpaid", createdAt: at(now + DAY) }, now), false);
});

test("a 31-day-old unpaid race is deleted with all its data; 29-day unpaid, 31-day paid and 31-day expired races stay", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-expiry");
    const crew = uid("crew-expiry");

    // The race that expires was paid, used (course, crew, invite, ping, chat), then refunded.
    const expiring = await createRace(app, runner, "Refunded 50k");
    await setEntitlement(app, expiring.id, runner, "paid");
    const course = await app.inject({
      method: "PUT",
      url: `/race-rooms/${expiring.id}/course`,
      headers: auth(app, runner),
      payload: {
        course: {
          checkpoints: [
            { id: "cp0", latitude: 42.0, longitude: -70.0 },
            { id: "cp1", latitude: 42.01, longitude: -70.0 }
          ]
        },
        routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
          { latitude: 42.0, longitude: -70.0 },
          { latitude: 42.01, longitude: -70.0 }
        ]),
        plannedPaceSecondsPerKm: 720,
        raceStartAt: iso(Date.now() - 60 * MINUTE)
      }
    });
    assert.equal(course.statusCode, 200, course.body);
    const joined = await app.inject({
      method: "POST",
      url: "/race-rooms/join-by-code",
      payload: { roomCode: expiring.joinCode },
      headers: auth(app, crew)
    });
    assert.equal(joined.statusCode, 200, joined.body);
    const invite = await app.inject({
      method: "POST",
      url: `/race-rooms/${expiring.id}/invites`,
      payload: { email: `${uid("pending")}@example.com`, role: "crew_member" },
      headers: auth(app, runner)
    });
    assert.equal(invite.statusCode, 201, invite.body);
    const inviteToken = (invite.json() as { token: string }).token;
    const ping = await app.inject({
      method: "POST",
      url: `/race-rooms/${expiring.id}/pings`,
      headers: auth(app, runner),
      payload: { latitude: 42.005, longitude: -70.0, recordedAt: iso(Date.now() - 20_000) }
    });
    assert.equal(ping.statusCode, 201, ping.body);
    const sent = await app.inject({
      method: "POST",
      url: `/chat/rooms/${expiring.id}/messages`,
      headers: auth(app, crew),
      payload: { clientMessageId: randomUUID(), text: "see you at the aid" }
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const reminderStartMs = Date.now() + 30 * MINUTE;
    assert.equal(await claimTrackingReminder(expiring.id, "t45", reminderStartMs, Date.now()), "claimed");
    await recordFinishedEffort({
      roomId: expiring.id,
      athleteUserId: runner,
      finishedAt: iso(Date.now() - 10 * MINUTE),
      courseLengthMeters: 1_100,
      actualFinishSeconds: 3_000,
      stops: []
    });
    await importCourseHistoryEvents([
      {
        formatVersion: COURSE_HISTORY_FORMAT_VERSION,
        source: "crewcue",
        sourceEventId: expiring.id,
        name: "Refunded 50k",
        startTime: iso(Date.now() - 60 * MINUTE),
        checkpoints: [
          { id: "e0", name: "Start", distanceMeters: 0, latitude: 42.0, longitude: -70.0 },
          { id: "e1", name: "Finish", distanceMeters: 1_100, latitude: 42.01, longitude: -70.0 }
        ],
        efforts: [{ splits: [{ checkpointId: "e1", inSeconds: 3_000 }] }]
      }
    ]);
    const historyId = courseHistoryEventId({ source: "crewcue", sourceEventId: expiring.id });
    assert.equal((await getCourseHistoryEvents([historyId])).length, 1);
    assert.equal((await listTrackPoints(expiring.id, undefined, 1000)).length, 1);
    assert.ok(await getProjectionViewForRoom(expiring.id), "the ping made a projection");
    assert.equal((await listChatMessages({ roomId: expiring.id, limit: 50 })).length, 1);
    await setEntitlement(app, expiring.id, runner, "unpaid");
    await setRaceRoomCreatedAtForTests(expiring.id, daysAgo(31));

    const young = await unpaidRace(app, uid("runner-young"), 29);
    const paid = await unpaidRace(app, uid("runner-paid"), 31, "paid");
    const expired = await unpaidRace(app, uid("runner-expired"), 31, "expired");

    const log = recordingLog();
    const outcomes = await sweeper(log).tick();
    assert.deepEqual(forRoom(outcomes, expiring.id), ["deleted"]);
    for (const kept of [young, paid, expired]) {
      assert.deepEqual(forRoom(outcomes, kept.id), [], "never a candidate");
      assert.ok(await getRaceRoom(kept.id), "still stored");
    }
    assert.equal((await getRaceRoom(paid.id))?.entitlement.status, "paid");
    assert.equal((await getRaceRoom(expired.id))?.entitlement.status, "expired");
    assert.deepEqual(log.warns, []);

    // The race is gone for everyone, by id and by code, with everything keyed by it.
    assert.equal(await getRaceRoom(expiring.id), undefined);
    for (const user of [runner, crew]) {
      const read = await app.inject({ method: "GET", url: `/race-rooms/${expiring.id}`, headers: auth(app, user) });
      assert.equal(read.statusCode, 404, read.body);
      const mine = await app.inject({ method: "GET", url: "/race-rooms/mine", headers: auth(app, user) });
      assert.equal(
        (mine.json() as { rooms: RaceRoom[] }).rooms.some((room) => room.id === expiring.id),
        false,
        `${user}'s list`
      );
    }
    const byCode = await app.inject({
      method: "POST",
      url: "/race-rooms/join-by-code",
      payload: { roomCode: expiring.joinCode },
      headers: auth(app, uid("late-joiner"))
    });
    assert.equal(byCode.statusCode, 404, byCode.body);
    const accept = await app.inject({
      method: "POST",
      url: `/race-rooms/${expiring.id}/invites/accept`,
      payload: { token: inviteToken },
      headers: auth(app, uid("invitee"))
    });
    assert.equal(accept.statusCode, 404, accept.body);
    const latest = await app.inject({
      method: "GET",
      url: `/race-rooms/${expiring.id}/pings/latest`,
      headers: auth(app, crew)
    });
    assert.equal(latest.statusCode, 404, latest.body);
    assert.deepEqual(await listTrackPoints(expiring.id, undefined, 1000), []);
    assert.equal(await getProjectionViewForRoom(expiring.id), undefined);
    assert.deepEqual(await listChatMessages({ roomId: expiring.id, limit: 50 }), []);
    assert.deepEqual(await listTrackingReminderClaims(expiring.id), []);
    assert.deepEqual(await listFinishedEfforts({ athleteUserId: runner }), []);
    assert.deepEqual(await getCourseHistoryEvents([historyId]), []);

    // The next tick finds nothing more of it.
    assert.deepEqual(forRoom(await sweeper().tick(), expiring.id), []);
    for (const room of [young, paid, expired]) {
      await deleteRaceRoomAndData(room.id);
    }
  });
});

test("a race paid between the listing and the delete survives", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-pays-late");
    const room = await unpaidRace(app, runner, 31);
    const listRooms: UnpaidRaceExpiryListRooms = async (createdBeforeMs, limit) => {
      const listed = await listUnpaidRaceRoomsCreatedBefore(createdBeforeMs, limit);
      // The purchase lands after the listing saw the race unpaid.
      await setEntitlement(app, room.id, runner, "paid");
      return listed;
    };
    const log = recordingLog();
    const outcomes = await sweeper(log, listRooms).tick();
    assert.deepEqual(forRoom(outcomes, room.id), ["kept"]);
    assert.equal((await getRaceRoom(room.id))?.entitlement.status, "paid");
    assert.deepEqual(log.warns, []);
    await deleteRaceRoomAndData(room.id);
  });
});

test("a Race Pass recorded but not yet applied to the race (webhook waiting on the room) keeps it", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-grant-pending");
    const room = await unpaidRace(app, runner, 31);
    await upsertBillingGrant({
      transactionId: uid("txn"),
      roomId: room.id,
      productId: "race_pass",
      appUserId: runner,
      source: "revenuecat",
      status: "active"
    });
    assert.equal((await getRaceRoom(room.id))?.entitlement.status, "unpaid");
    assert.deepEqual(forRoom(await sweeper().tick(), room.id), ["kept"]);
    assert.ok(await getRaceRoom(room.id));

    // A refunded pass no longer protects it.
    const [grant] = await listBillingGrantsForRoom(room.id);
    await upsertBillingGrant({ ...grant!, status: "revoked" });
    assert.deepEqual(forRoom(await sweeper().tick(), room.id), ["deleted"]);
    assert.equal(await getRaceRoom(room.id), undefined);
  });
});

test("two sweepers ticking at once delete the race once, with no error", async () => {
  await withApp(async (app) => {
    const room = await unpaidRace(app, uid("runner-two-sweepers"), 31);
    // Both listings finish before either sweeper deletes, as on two instances.
    let listedCount = 0;
    let bothListed!: () => void;
    const barrier = new Promise<void>((resolve) => {
      bothListed = resolve;
    });
    const listRooms: UnpaidRaceExpiryListRooms = async (createdBeforeMs, limit) => {
      const listed = await listUnpaidRaceRoomsCreatedBefore(createdBeforeMs, limit);
      listedCount += 1;
      if (listedCount === 2) bothListed();
      await barrier;
      return listed;
    };
    const [logA, logB] = [recordingLog(), recordingLog()];
    const [a, b] = await Promise.all([sweeper(logA, listRooms).tick(), sweeper(logB, listRooms).tick()]);
    const results = [...forRoom(a, room.id), ...forRoom(b, room.id)].sort();
    assert.deepEqual(results, ["deleted", "gone"]);
    assert.deepEqual([...logA.warns, ...logB.warns], []);
    assert.equal(await getRaceRoom(room.id), undefined);
  });
});

test("a listed race that is already gone is skipped, and deleting twice is not an error", async () => {
  await withApp(async (app) => {
    const missing = randomUUID();
    const log = recordingLog();
    const outcomes = await sweeper(log, async () => [
      { id: missing, entitlementStatus: "unpaid", createdAt: daysAgo(40) }
    ]).tick();
    assert.deepEqual(outcomes, [{ roomId: missing, result: "gone" }]);
    assert.deepEqual(log.warns, []);

    const room = await unpaidRace(app, uid("runner-twice"), 31);
    assert.equal(await deleteRaceRoomAndData(room.id), "deleted");
    assert.equal(await deleteRaceRoomAndData(room.id), "gone");
    assert.equal(await deleteRaceRoomAndData(room.id, () => true), "gone");
  });
});

test("candidates: unpaid races past the cutoff, oldest first; paid, expired, newer and undated races are not listed", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-candidates");
    const oldest = await unpaidRace(app, runner, 45);
    const older = await unpaidRace(app, runner, 31);
    const young = await unpaidRace(app, uid("runner-candidates-young"), 29);
    const paid = await unpaidRace(app, uid("runner-candidates-paid"), 60, "paid");
    const expired = await unpaidRace(app, uid("runner-candidates-expired"), 60, "expired");
    const undated = await createRace(app, uid("runner-candidates-undated"));
    await setRaceRoomCreatedAtForTests(undated.id, undefined);
    const ours = new Set([oldest.id, older.id, young.id, paid.id, expired.id, undated.id]);

    const listed = (await listUnpaidRaceRoomsCreatedBefore(Date.now() - UNPAID_RACE_TTL_MS, 10_000)).filter((room) =>
      ours.has(room.id)
    );
    assert.deepEqual(
      listed.map((room) => room.id),
      [oldest.id, older.id]
    );
    for (const room of listed) {
      assert.deepEqual(Object.keys(room).sort(), ["createdAt", "entitlementStatus", "id"], "only the sweeper's fields");
      assert.equal(room.entitlementStatus, "unpaid");
    }

    // The undated race is never deleted, even when handed to the sweeper directly.
    const outcomes = await sweeper(recordingLog(), async () => [
      { id: undated.id, entitlementStatus: "unpaid", createdAt: undefined }
    ]).tick();
    assert.deepEqual(outcomes, []);
    assert.ok(await getRaceRoom(undated.id));

    for (const room of [oldest, older, young, paid, expired, undated]) {
      await deleteRaceRoomAndData(room.id);
    }
  });
});

test("a tick deletes at most batchSize races and logs counts only, never ids", async () => {
  const deleted: string[] = [];
  const log = recordingLog();
  const rooms = ["room-a", "room-b", "room-c"].map((id) => ({
    id,
    entitlementStatus: "unpaid" as const,
    createdAt: daysAgo(40)
  }));
  let askedLimit: number | undefined;
  const scheduler = createUnpaidRaceExpiryScheduler({
    listRooms: async (_createdBeforeMs, limit) => {
      askedLimit = limit;
      return rooms;
    },
    deleteRoom: async (roomId) => {
      deleted.push(roomId);
      return roomId === "room-b" ? "gone" : "deleted";
    },
    log,
    batchSize: 2,
    skipFirstRun: true
  });
  const outcomes = await scheduler.tick();
  assert.equal(askedLimit, 2);
  assert.deepEqual(deleted, ["room-a", "room-b"]);
  assert.deepEqual(outcomes, [
    { roomId: "room-a", result: "deleted" },
    { roomId: "room-b", result: "gone" }
  ]);
  const pass = log.infos.find((line) => line.msg === "unpaid_race_expiry_pass");
  assert.deepEqual(pass?.payload, { unpaidRaceExpiry: { listed: 3, deleted: 1, kept: 0, gone: 1, failed: 0 } });
  assert.equal(JSON.stringify(log.infos).includes("room-"), false);
});

test("a failing delete is logged without the room id and the rest of the tick goes on; a failing listing returns nothing", async () => {
  const log = recordingLog();
  const scheduler = createUnpaidRaceExpiryScheduler({
    listRooms: async () => [
      { id: "room-fails", entitlementStatus: "unpaid", createdAt: daysAgo(40) },
      { id: "room-next", entitlementStatus: "unpaid", createdAt: daysAgo(40) }
    ],
    deleteRoom: async (roomId) => {
      if (roomId === "room-fails") throw new Error("database unavailable");
      return "deleted";
    },
    log,
    skipFirstRun: true
  });
  assert.deepEqual(await scheduler.tick(), [
    { roomId: "room-fails", result: "error" },
    { roomId: "room-next", result: "deleted" }
  ]);
  assert.deepEqual(
    log.warns.map((line) => line.msg),
    ["unpaid_race_expiry_delete_failed"]
  );
  const warned = log.warns.map((line) => (line.payload as { unpaidRaceExpiry: unknown }).unpaidRaceExpiry);
  assert.deepEqual(warned, [{ phase: "delete" }], "no room id in the log");

  const listingLog = recordingLog();
  const failingList = createUnpaidRaceExpiryScheduler({
    listRooms: async () => {
      throw new Error("database unavailable");
    },
    log: listingLog,
    skipFirstRun: true
  });
  assert.deepEqual(await failingList.tick(), []);
  assert.deepEqual(
    listingLog.warns.map((line) => line.msg),
    ["unpaid_race_expiry_pass_failed"]
  );
});

test("the sweeper starts with the app, ticks on its interval, and stops on app close", async () => {
  const app = Fastify();
  let calls = 0;
  const sweep = attachUnpaidRaceExpiryScheduler(app, {
    listRooms: async () => {
      calls += 1;
      return [];
    },
    log: recordingLog(),
    intervalMs: 5
  });
  assert.equal(sweep.running, false);
  await app.ready();
  assert.equal(sweep.running, true);
  const deadline = Date.now() + 2000;
  while (calls < 3 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(calls >= 3, `ticked ${calls} times`);
  await app.close();
  assert.equal(sweep.running, false);
  const afterClose = calls;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, afterClose, "no tick after close");
});

test("app close does not wait on a hung tick past its bound", async () => {
  const app = Fastify();
  let listed = false;
  const sweep = attachUnpaidRaceExpiryScheduler(app, {
    // Never settles: a store call that hangs.
    listRooms: () => {
      listed = true;
      return new Promise(() => undefined);
    },
    log: recordingLog(),
    stopWaitMs: 20
  });
  await app.ready();
  const deadline = Date.now() + 2000;
  while (!listed && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(listed, "the first tick runs on start");
  const closing = Date.now();
  await app.close();
  assert.equal(sweep.running, false);
  assert.ok(Date.now() - closing < 2000, "close returned without waiting for the hung tick");
});
