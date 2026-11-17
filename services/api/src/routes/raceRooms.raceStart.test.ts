/**
 * Race start (runner and crew onboarding, PR 3). A ping recorded before `raceStartAt` (the
 * runner's "test tracking now", or one sent on race morning before the gun) is stored, and the
 * latest one shows the runner's dot, but it never moves the projection, its ETAs, the schedule or
 * the projection's freshness. The start is set on its own route. The finish ETA is the arrival at
 * the finish line, read at the end of the route. Unpaid-race shaping of the start route is in
 * raceRooms.teaser.test.ts. Runs in memory and on Postgres (CI).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCrewScheduleSheet,
  type AthletePingBatchResponse,
  type CrewScheduleSheet,
  type PacingEstimate,
  type RaceRoom,
  type RaceRoomLatestPingResponse,
  type RaceRoomPingTrackResponse,
  type RaceRoomProjection
} from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { resetPacingEstimateStoreForTests } from "../lib/pacingEstimateStore.js";
import { plannedElapsedSecondsForDistance } from "../lib/raceProjection.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";

type App = ReturnType<typeof buildApp>;
type Checkpoints = ReturnType<typeof load50kCourseWithAids>["checkpoints"];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The 50k fixture's start line. Its route runs due north from here. */
const START = { latitude: 39.15, longitude: -120.25 };
/** The runner's home, about 280 km from the start. */
const HOME = { latitude: 37.77, longitude: -122.42 };
/** `meters` up the route from the start (its first leg runs due north). */
const upRoute = (meters: number) => ({ latitude: START.latitude + meters / 111_195, longitude: START.longitude });
/** `meters` due south of the start, off the route. */
const southOfStart = (meters: number) => ({ latitude: START.latitude - meters / 111_195, longitude: START.longitude });

const iso = (ms: number) => new Date(ms).toISOString();
/** Whole seconds, so the ISO string the server stores round-trips exactly. */
const wholeSecond = (ms: number) => Math.floor(ms / 1000) * 1000;

function auth(app: App, sub: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} })}` };
}

async function withApp(run: (app: App) => Promise<void>): Promise<void> {
  await resetPacingEstimateStoreForTests();
  const app = buildApp();
  await app.ready();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

/** A paid race for `runner` on the 50k fixture (every checkpoint, the finish included, plans a 120 s stop). */
async function paidRace(
  app: App,
  runner: string,
  raceStartAt: string,
  checkpoints: Checkpoints = load50kCourseWithAids().checkpoints
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: runner, name: "Race start 50k", creatorRole: "athlete" },
    headers: auth(app, runner)
  });
  assert.equal(created.statusCode, 201, created.body);
  const roomId = (created.json() as RaceRoom).id;
  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: auth(app, runner)
  });
  assert.equal(paid.statusCode, 200, paid.body);
  const fixture = load50kCourseWithAids();
  const course = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: { checkpoints },
      routeOverlayLayer: fixture.routeOverlayLayer,
      raceStartAt
    },
    headers: auth(app, runner)
  });
  assert.equal(course.statusCode, 200, course.body);
  return roomId;
}

const get = (app: App, url: string, user: string) => app.inject({ method: "GET", url, headers: auth(app, user) });

function ping(app: App, roomId: string, runner: string, at: { latitude: number; longitude: number }, recordedAtMs: number) {
  return app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: { ...at, recordedAt: iso(recordedAtMs), uploadIntervalSeconds: 30 },
    headers: auth(app, runner)
  });
}

function patchStart(app: App, roomId: string, user: string, raceStartAt: unknown, idempotencyKey?: string) {
  return app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/race-start`,
    payload: { raceStartAt },
    headers: { ...auth(app, user), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }
  });
}

/** Everything a test ping must leave alone: the projection, the schedule and the room. */
async function raceReads(app: App, roomId: string, user: string) {
  const projection = await get(app, `/race-rooms/${roomId}/projection`, user);
  assert.equal(projection.statusCode, 200, projection.body);
  const schedule = await get(app, `/race-rooms/${roomId}/schedule`, user);
  assert.equal(schedule.statusCode, 200, schedule.body);
  const room = await get(app, `/race-rooms/${roomId}`, user);
  assert.equal(room.statusCode, 200, room.body);
  const { evaluatedAt: _evaluatedAt, ...projectionBody } = projection.json() as RaceRoomProjection;
  return {
    projection: projectionBody,
    schedule: parseCrewScheduleSheet(schedule.json()),
    room: (room.json() as { room: RaceRoom }).room
  };
}

async function latest(app: App, roomId: string, user: string): Promise<RaceRoomLatestPingResponse> {
  const response = await get(app, `/race-rooms/${roomId}/pings/latest`, user);
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as RaceRoomLatestPingResponse;
}

async function track(app: App, roomId: string, user: string): Promise<RaceRoomPingTrackResponse["points"]> {
  const response = await get(app, `/race-rooms/${roomId}/pings/track`, user);
  assert.equal(response.statusCode, 200, response.body);
  return (response.json() as RaceRoomPingTrackResponse).points;
}

/** The finish the schedule's finish row shows: its arrival, seconds from `raceStartAt`. */
function scheduleFinishSeconds(sheet: CrewScheduleSheet, raceStartAt: string): number {
  return (Date.parse(sheet.stops[sheet.stops.length - 1]!.clockArrivalAt) - Date.parse(raceStartAt)) / 1000;
}

const sinceStart = (isoTime: string, raceStartAt: string) => (Date.parse(isoTime) - Date.parse(raceStartAt)) / 1000;

function withinASecond(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= 1, `${label}: ${actual} vs ${expected}`);
}

/** The plan to the course length and every planned stop but the finish's, as a paid room stores them. */
function plannedFinishSeconds(room: RaceRoom, courseLengthMeters: number): number {
  const checkpoints = room.course!.checkpoints;
  const finish = checkpoints.reduce((far, checkpoint) =>
    checkpoint.distanceMetersFromStart! >= far.distanceMetersFromStart! ? checkpoint : far
  );
  const stops = checkpoints
    .filter((checkpoint) => checkpoint.id !== finish.id)
    .reduce((sum, checkpoint) => sum + (checkpoint.plannedStopSeconds ?? 0), 0);
  return (
    plannedElapsedSecondsForDistance({
      distanceMetersFromStart: courseLengthMeters,
      plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm!,
      baselineTrack: room.course!.baselineTrack,
      courseLengthMeters
    }) + stops
  );
}

test("a test ping days before the start, from far away, moves nothing; the first race ping is accepted and drives the projection", async (t) => {
  // The server clock moves from days before the start to the race (only Date is mocked).
  const realNow = wholeSecond(Date.now());
  t.mock.timers.enable({ apis: ["Date"], now: realNow });
  await withApp(async (app) => {
    const runner = "runner-race-start-test-ping";
    const raceStartMs = realNow + 3 * DAY;
    const raceStartAt = iso(raceStartMs);
    const roomId = await paidRace(app, runner, raceStartAt);
    const before = await raceReads(app, roomId, runner);
    assert.equal(before.projection.asOfPingId, "bootstrap");
    assert.equal(before.projection.projectionConfidence, "degraded");
    const thresholdBefore = (await latest(app, roomId, runner)).stalenessThresholdSeconds;

    // "Test tracking now", three days out, from home.
    const fromHome = await ping(app, roomId, runner, HOME, Date.now());
    assert.equal(fromHome.statusCode, 201, fromHome.body);
    const homePing = fromHome.json() as { decision: string; pingId: string; projection?: unknown };
    assert.equal(homePing.decision, "accepted");
    assert.equal(Object.hasOwn(homePing, "projection"), false, "a test ping does not move the projection");

    const afterHome = await raceReads(app, roomId, runner);
    assert.deepEqual(afterHome.projection, before.projection, "projection, ETAs and freshness unchanged");
    assert.deepEqual(afterHome.schedule, before.schedule, "schedule unchanged");
    assert.deepEqual(afterHome.room, before.room, "room unchanged");
    assert.equal(afterHome.room.status, "active");
    const dot = await latest(app, roomId, runner);
    assert.equal(dot.ping?.pingId, homePing.pingId, "the latest ping still shows the runner's dot");
    assert.equal(dot.ping?.preStart, true);
    assert.equal(dot.ping?.latitude, HOME.latitude);
    assert.equal(Object.hasOwn(dot.ping ?? {}, "progressMeters"), false);
    assert.equal(dot.stalenessThresholdSeconds, thresholdBefore, "its upload interval is not adopted");

    // Race morning, an hour before the gun, on the drive in 60 km out: still a test ping.
    t.mock.timers.setTime(raceStartMs - HOUR);
    const onTheDrive = await ping(app, roomId, runner, southOfStart(60_000), Date.now());
    assert.equal(onTheDrive.statusCode, 201, onTheDrive.body);
    const afterDrive = await raceReads(app, roomId, runner);
    assert.deepEqual(afterDrive.projection, before.projection);
    assert.deepEqual(afterDrive.schedule, before.schedule);
    assert.equal((await latest(app, roomId, runner)).ping?.preStart, true);

    // A minute after the gun, at the start line. Against the ping 61 minutes before, 60 km away,
    // that is 16 m/s: it would be implausible_motion. It is the race's first ping.
    t.mock.timers.setTime(raceStartMs + MINUTE);
    const first = await ping(app, roomId, runner, START, Date.now());
    assert.equal(first.statusCode, 201, first.body);
    const firstPing = first.json() as { decision: string; pingId: string; projection?: RaceRoomProjection };
    assert.equal(firstPing.decision, "accepted");
    assert.equal(firstPing.projection?.asOfPingId, firstPing.pingId, "the race ping drives the projection");

    const raced = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
    assert.equal(raced.asOfPingId, firstPing.pingId);
    assert.equal(raced.projectionConfidence, "fresh");
    assert.equal(raced.stalenessThresholdSeconds, 90, "the race ping's upload interval is adopted");
    assert.ok(raced.progressMeters < 50, `at the start line: ${raced.progressMeters} m`);
    assert.equal(raced.checkpointSplits[0]!.crossedAtRecordedAt, raceStartAt, "the start is crossed at the start");
    assert.deepEqual(
      raced.checkpointSplits.slice(1).map((row) => row.crossedAtRecordedAt),
      [null, null, null, null],
      "nothing the test pings projected onto the route counts as crossed"
    );
    const raceDot = await latest(app, roomId, runner);
    assert.equal(raceDot.ping?.pingId, firstPing.pingId);
    assert.equal(Object.hasOwn(raceDot.ping ?? {}, "preStart"), false);
    assert.ok(typeof raceDot.ping?.progressMeters === "number");

    // Two minutes on, 300 m up the route.
    t.mock.timers.setTime(raceStartMs + 3 * MINUTE);
    const second = await ping(app, roomId, runner, upRoute(300), Date.now());
    assert.equal(second.statusCode, 201, second.body);
    const moved = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
    assert.ok(moved.progressMeters > 250 && moved.progressMeters < 350, `progress ${moved.progressMeters}`);

    assert.deepEqual(
      (await track(app, roomId, runner)).map((point) => point.preStart ?? false),
      [true, true, false, false],
      "the track marks the test pings"
    );
  });
});

test("a backlog with pre-start and race samples: only the race samples count, and the pre-start ones never refuse them", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-backlog";
    const now = wholeSecond(Date.now());
    const raceStartMs = now - 10 * MINUTE;
    const raceStartAt = iso(raceStartMs);
    const mixedRoom = await paidRace(app, runner, raceStartAt);
    const raceOnlyRoom = await paidRace(app, runner, raceStartAt);

    const race = [
      { ...START, recordedAt: iso(raceStartMs + MINUTE) },
      { ...upRoute(300), recordedAt: iso(raceStartMs + 4 * MINUTE) },
      { ...upRoute(700), recordedAt: iso(raceStartMs + 8 * MINUTE) }
    ];
    const preStart = [
      // Older than the hour of warm-up a backlog may carry once the race has begun.
      { ...HOME, recordedAt: iso(raceStartMs - 2 * HOUR) },
      // The hotel, 40 minutes out, and still 20 km away two minutes before the gun: 111 m/s to
      // the first race sample, which judged against it would be implausible_motion.
      { ...southOfStart(20_000), recordedAt: iso(raceStartMs - 40 * MINUTE) },
      { ...southOfStart(20_000), recordedAt: iso(raceStartMs - 2 * MINUTE) }
    ];
    const upload = (roomId: string, points: Array<Record<string, unknown>>) =>
      app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/pings/batch`,
        payload: { points },
        headers: auth(app, runner)
      });

    const mixed = await upload(mixedRoom, [...preStart, ...race]);
    assert.equal(mixed.statusCode, 200, mixed.body);
    const results = (mixed.json() as AthletePingBatchResponse).results;
    assert.deepEqual(
      results.map((result) => result.reason ?? result.decision),
      ["clock_skew", "accepted", "accepted", "accepted", "accepted", "accepted"]
    );
    const raceOnly = await upload(raceOnlyRoom, race);
    assert.equal(raceOnly.statusCode, 200, raceOnly.body);

    const shown = async (roomId: string) => {
      const projection = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
      return {
        asOfRecordedAt: projection.asOfRecordedAt,
        progressMeters: projection.progressMeters,
        etaFinishPlanIso: projection.etaFinishPlanIso,
        checkpointSplits: projection.checkpointSplits,
        stoppageSummary: projection.stoppageSummary,
        projectionConfidence: projection.projectionConfidence
      };
    };
    const mixedProjection = await shown(mixedRoom);
    assert.deepEqual(mixedProjection, await shown(raceOnlyRoom), "the pre-start samples change nothing");
    assert.equal(mixedProjection.asOfRecordedAt, race[2]!.recordedAt);
    assert.ok(mixedProjection.progressMeters > 650 && mixedProjection.progressMeters < 750);
    assert.deepEqual(
      parseCrewScheduleSheet((await get(app, `/race-rooms/${mixedRoom}/schedule`, runner)).json()).stops.map((stop) => stop.clockArrivalAt),
      parseCrewScheduleSheet((await get(app, `/race-rooms/${raceOnlyRoom}/schedule`, runner)).json()).stops.map((stop) => stop.clockArrivalAt)
    );
    assert.deepEqual(
      (await track(app, mixedRoom, runner)).map((point) => point.preStart ?? false),
      [true, true, false, false, false],
      "both pre-start samples are stored, and marked"
    );
    assert.equal((await latest(app, mixedRoom, runner)).ping?.preStart, undefined);
  });
});

test("with no ping before the start, a paid race's finish is the start plus the plan, the schedule's finish-row arrival, without the finish's own stop", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-pre-race-finish";
    const raceStartAt = iso(wholeSecond(Date.now() + 3 * DAY));
    const roomId = await paidRace(app, runner, raceStartAt);
    const reads = async (label: string) => {
      const { projection, schedule, room } = await raceReads(app, roomId, runner);
      assert.ok(room.course?.baselineTrack, `${label}: a paid room carries its plan curve`);
      const finish = sinceStart(projection.etaFinishPlanIso, raceStartAt);
      withinASecond(finish, plannedFinishSeconds(room, projection.courseLengthMeters), `${label}: start plus the plan`);
      withinASecond(scheduleFinishSeconds(schedule, raceStartAt), finish, `${label}: the schedule's finish row`);
      return { finish, room };
    };
    const noPlan = await reads("no plan attached");
    // Every checkpoint plans 120 s: the four before the finish count, the finish's does not.
    assert.deepEqual(
      noPlan.room.course!.checkpoints.map((checkpoint) => checkpoint.plannedStopSeconds),
      [120, 120, 120, 120, 120]
    );
    const courseLengthMeters = (await raceReads(app, roomId, runner)).projection.courseLengthMeters;
    const moving = plannedElapsedSecondsForDistance({
      distanceMetersFromStart: courseLengthMeters,
      plannedPaceSecondsPerKm: noPlan.room.plannedPaceSecondsPerKm!,
      baselineTrack: noPlan.room.course!.baselineTrack,
      courseLengthMeters
    });
    withinASecond(noPlan.finish, moving + 4 * 120, "four stops, not five");

    const computed = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      payload: { roomId },
      headers: auth(app, runner)
    });
    assert.equal(computed.statusCode, 200, computed.body);
    const plan = computed.json() as PacingEstimate;
    const attach = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/pacing-estimate`,
      payload: { pacingEstimateId: plan.id },
      headers: auth(app, runner)
    });
    assert.equal(attach.statusCode, 200, attach.body);
    const withPlan = await reads("plan attached");
    withinASecond(withPlan.finish, plan.expectedFinishElapsedSeconds + 4 * 120, "the plan's finish plus the stops before it");
  });
});

test("a paid course with no finish waypoint reads its finish at the end of the route, not at its last aid", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-no-finish";
    const raceStartAt = iso(wholeSecond(Date.now() + 3 * DAY));
    const fixture = load50kCourseWithAids().checkpoints;
    const compute = async (roomId: string) => {
      const computed = await app.inject({
        method: "POST",
        url: "/pacing-estimates",
        payload: { roomId },
        headers: auth(app, runner)
      });
      assert.equal(computed.statusCode, 200, computed.body);
      return computed.json() as PacingEstimate;
    };
    const full = await compute(await paidRace(app, runner, raceStartAt));
    const noFinishRoom = await paidRace(
      app,
      runner,
      raceStartAt,
      fixture.filter((checkpoint) => checkpoint.id !== "finish")
    );
    const noFinish = await compute(noFinishRoom);
    const lastAid = noFinish.aidEtas.find((eta) => eta.checkpointId === "aid-3");
    assert.ok(lastAid, "the last aid keeps its own ETA");
    assert.equal(noFinish.expectedFinishElapsedSeconds, full.expectedFinishElapsedSeconds, "the route end's finish");
    assert.ok(noFinish.expectedFinishElapsedSeconds > lastAid.elapsedSeconds + 600, "never the last aid's ETA");
    assert.deepEqual(noFinish.bands, full.bands);

    // Attached, the projection's finish is that finish (plus the stops before it), the schedule's
    // finish row too.
    const attach = await app.inject({
      method: "PUT",
      url: `/race-rooms/${noFinishRoom}/pacing-estimate`,
      payload: { pacingEstimateId: noFinish.id },
      headers: auth(app, runner)
    });
    assert.equal(attach.statusCode, 200, attach.body);
    const { projection, schedule } = await raceReads(app, noFinishRoom, runner);
    // aid-3 is the farthest checkpoint, so its own stop is after the finish row's arrival.
    withinASecond(sinceStart(projection.etaFinishPlanIso, raceStartAt), noFinish.expectedFinishElapsedSeconds + 3 * 120, "projection");
    withinASecond(scheduleFinishSeconds(schedule, raceStartAt), noFinish.expectedFinishElapsedSeconds + 3 * 120, "schedule finish row");
  });
});

test("PATCH race-start: the runner moves the start, and the projection and schedule move with it", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-patch";
    const raceStartMs = wholeSecond(Date.now() + 3 * DAY);
    const raceStartAt = iso(raceStartMs);
    const roomId = await paidRace(app, runner, raceStartAt);
    const before = await raceReads(app, roomId, runner);

    const laterStart = iso(raceStartMs + 90 * MINUTE);
    const patched = await patchStart(app, roomId, runner, laterStart);
    assert.equal(patched.statusCode, 200, patched.body);
    const body = patched.json() as RaceRoom;
    assert.equal(body.id, roomId);
    assert.equal(body.raceStartAt, laterStart);
    assert.equal(body.activatedAt, laterStart, "the legacy anchor moves with it, as on a course save");
    assert.ok(body.course?.baselineTrack, "a paid room goes out whole");
    assert.deepEqual(body.course?.checkpoints, before.room.course?.checkpoints, "the course is untouched");

    const after = await raceReads(app, roomId, runner);
    assert.equal(after.room.raceStartAt, laterStart);
    withinASecond(
      (Date.parse(after.projection.etaFinishPlanIso) - Date.parse(before.projection.etaFinishPlanIso)) / 1000,
      90 * 60,
      "the pre-race finish moves with the start"
    );
    assert.equal(after.projection.checkpointSplits[0]!.crossedAtRecordedAt, laterStart);
    assert.equal(after.schedule.raceStartAt, laterStart);
    assert.deepEqual(
      after.schedule.stops.map((stop) => Date.parse(stop.clockArrivalAt) - 90 * MINUTE),
      before.schedule.stops.map((stop) => Date.parse(stop.clockArrivalAt)),
      "every schedule row moves with the start"
    );
    assert.deepEqual(
      after.schedule.stops.map((stop) => stop.elapsedSeconds),
      before.schedule.stops.map((stop) => stop.elapsedSeconds)
    );
  });
});

test("PATCH race-start: course editors only, a Z time only", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-gates";
    const raceStartAt = iso(wholeSecond(Date.now() + 3 * DAY));
    const roomId = await paidRace(app, runner, raceStartAt);
    const room = (await get(app, `/race-rooms/${roomId}`, runner)).json() as { room: RaceRoom };
    const joined = await app.inject({
      method: "POST",
      url: "/race-rooms/join-by-code",
      payload: { roomCode: room.room.joinCode },
      headers: auth(app, "crew-race-start-gates")
    });
    assert.equal(joined.statusCode, 200, joined.body);

    const crew = await patchStart(app, roomId, "crew-race-start-gates", iso(Date.parse(raceStartAt) + HOUR));
    assert.equal(crew.statusCode, 403, crew.body);
    assert.deepEqual(crew.json(), { error: "Insufficient permissions" });
    assert.equal((await patchStart(app, roomId, "stranger-race-start-gates", raceStartAt)).statusCode, 403);
    const anonymous = await app.inject({ method: "PATCH", url: `/race-rooms/${roomId}/race-start`, payload: { raceStartAt } });
    assert.equal(anonymous.statusCode, 401);
    assert.equal((await patchStart(app, "no-such-room", runner, raceStartAt)).statusCode, 404);

    for (const invalid of ["2026-12-01T07:00:00-07:00", "2026-12-01T07:00:00+00:00", "2026-12-01", "soon", 1_790_000_000_000, null]) {
      const refused = await patchStart(app, roomId, runner, invalid);
      assert.equal(refused.statusCode, 400, `${String(invalid)}: ${refused.body}`);
      assert.deepEqual(refused.json(), { error: "Invalid race start payload" });
    }
    const missing = await app.inject({
      method: "PATCH",
      url: `/race-rooms/${roomId}/race-start`,
      payload: {},
      headers: auth(app, runner)
    });
    assert.equal(missing.statusCode, 400);
    assert.equal((await get(app, `/race-rooms/${roomId}`, runner)).json().room.raceStartAt, raceStartAt, "nothing was written");
  });
});

test("PATCH race-start: a keyed retry replays against the room as it is now", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-idem";
    const raceStartMs = wholeSecond(Date.now() + 3 * DAY);
    const roomId = await paidRace(app, runner, iso(raceStartMs));
    const first = iso(raceStartMs + HOUR);
    const saved = await patchStart(app, roomId, runner, first, "race-start-key");
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal((saved.json() as RaceRoom).raceStartAt, first);

    // The start moves again, unkeyed; a retry of the keyed request does not move it back.
    const second = iso(raceStartMs + 2 * HOUR);
    assert.equal((await patchStart(app, roomId, runner, second)).statusCode, 200);
    const replay = await patchStart(app, roomId, runner, first, "race-start-key");
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal((replay.json() as RaceRoom).raceStartAt, second, "answered from the room as it is now");
    assert.equal(((await get(app, `/race-rooms/${roomId}`, runner)).json() as { room: RaceRoom }).room.raceStartAt, second);
    // The same key with another start is a conflict, not a write.
    const conflict = await patchStart(app, roomId, runner, iso(raceStartMs + 3 * HOUR), "race-start-key");
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(((await get(app, `/race-rooms/${roomId}`, runner)).json() as { room: RaceRoom }).room.raceStartAt, second);
  });
});

test("PATCH race-start with race pings: later than every ping makes them test pings; earlier re-anchors the race", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-moved";
    const now = wholeSecond(Date.now());
    const raceStartAt = iso(now - 20 * MINUTE);
    const roomId = await paidRace(app, runner, raceStartAt);
    const atStart = await ping(app, roomId, runner, START, now - 30_000);
    assert.equal(atStart.statusCode, 201, atStart.body);
    const pingId = (atStart.json() as { pingId: string }).pingId;
    const racing = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
    assert.equal(racing.asOfPingId, pingId);
    assert.equal(racing.projectionConfidence, "fresh");

    // Ten minutes earlier: the ping still counts, and the start crossing moves to the new start,
    // so the finish (anchored there) moves by the same ten minutes.
    const earlier = iso(now - 30 * MINUTE);
    assert.equal((await patchStart(app, roomId, runner, earlier)).statusCode, 200);
    const reanchored = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
    assert.equal(reanchored.asOfPingId, pingId);
    assert.equal(reanchored.checkpointSplits[0]!.crossedAtRecordedAt, earlier);
    withinASecond((Date.parse(racing.etaFinishPlanIso) - Date.parse(reanchored.etaFinishPlanIso)) / 1000, 10 * 60, "re-anchored finish");

    // Delayed past the ping: it is a test ping now. The projection is the pre-race one at the
    // new start, not fresh, and the dot is marked.
    const delayedMs = now + HOUR;
    assert.equal((await patchStart(app, roomId, runner, iso(delayedMs))).statusCode, 200);
    const { projection, room } = await raceReads(app, roomId, runner);
    assert.equal(projection.asOfPingId, "bootstrap");
    assert.equal(projection.projectionConfidence, "degraded");
    withinASecond(sinceStart(projection.etaFinishPlanIso, iso(delayedMs)), plannedFinishSeconds(room, projection.courseLengthMeters), "pre-race finish at the new start");
    const dot = await latest(app, roomId, runner);
    assert.equal(dot.ping?.pingId, pingId);
    assert.equal(dot.ping?.preStart, true);
    assert.deepEqual((await track(app, roomId, runner)).map((point) => point.preStart), [true]);
  });
});
