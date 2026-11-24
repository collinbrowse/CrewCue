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
import { getRoomPersistenceMode } from "../lib/roomPersistence.js";
import { runInFreshProcess } from "../lib/testFreshProcess.js";
import { plannedElapsedSecondsForDistance, withinCourseLength } from "../lib/raceProjection.js";
import { load50kCourseWithAids, pointOn50kRouteBeforeEnd } from "../lib/testCourseRouteLayer.js";
import {
  commitRaceRoomUpdate,
  getProjectionViewForRoom,
  refreshProjectionAfterPlanOfRecordChange,
  setWs2SnapshotSaveFailureForTests
} from "./raceRooms.js";

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
    assert.equal(dot.ping?.progressMeters, 0, "the race has not begun: a client never snaps it to a checkpoint");
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
    // No checkpoint is the finish line (aid-3 is 15 km short of the route's end), so every planned
    // stop, aid-3's too, is on the way there.
    withinASecond(sinceStart(projection.etaFinishPlanIso, raceStartAt), noFinish.expectedFinishElapsedSeconds + 4 * 120, "projection");
    // aid-3 keeps the plan's own aid-3 ETA plus the three stops before it: crews meet the runner
    // there, not at the finish time.
    const aid3 = schedule.stops.find((stop) => stop.checkpointId === "aid-3")!;
    assert.equal(aid3.movingElapsedSeconds, lastAid.elapsedSeconds);
    assert.equal(aid3.elapsedSeconds, lastAid.elapsedSeconds + 3 * 120);
    assert.equal(aid3.clockArrivalAt, iso(Date.parse(raceStartAt) + (lastAid.elapsedSeconds + 3 * 120) * 1000));
    // After it, a finish row at the end of the route, the timeline's TARGET: the plan's finish
    // plus every stop, aid-3's too, the projection's finish. It names no checkpoint of the course.
    assert.deepEqual(
      schedule.stops.map((stop) => stop.checkpointId),
      ["start", "aid-1", "aid-2", "aid-3", "finish"]
    );
    const finishRow = schedule.stops.at(-1)!;
    assert.equal(finishRow.id, "stop-finish");
    assert.equal(finishRow.movingElapsedSeconds, noFinish.expectedFinishElapsedSeconds);
    assert.equal(finishRow.elapsedSeconds, noFinish.expectedFinishElapsedSeconds + 4 * 120);
    assert.equal(finishRow.plannedStoppageSeconds, 0);
    withinASecond(scheduleFinishSeconds(schedule, raceStartAt), sinceStart(projection.etaFinishPlanIso, raceStartAt), "one finish");
    // Pace plans aid-3 where the schedule does.
    const aid3Split = projection.checkpointSplits.find((row) => row.checkpointId === "aid-3")!;
    withinASecond(aid3Split.plannedElapsedSecondsAtCross, lastAid.elapsedSeconds, "Pace's aid-3 split");

    // A legacy room (saved before course lengths were stored): the schedule reads the course
    // length the projection and the estimator do, the route's, never aid-3's. aid-3 keeps its own
    // ETA instead of taking the plan's finish.
    const legacy = await commitRaceRoomUpdate(noFinishRoom, (latest) => {
      const { courseDistanceMeters: _distance, ...room } = latest;
      const { derivedMetrics: _metrics, ...course } = latest.course!;
      return { ...room, course };
    });
    assert.ok(legacy);
    await refreshProjectionAfterPlanOfRecordChange(noFinishRoom, legacy);
    const legacyReads = await raceReads(app, noFinishRoom, runner);
    assert.equal(legacyReads.room.courseDistanceMeters, undefined, "no stored length");
    assert.equal(legacyReads.room.course?.derivedMetrics, undefined, "no stored length");
    assert.ok(Math.abs(legacyReads.projection.courseLengthMeters - projection.courseLengthMeters) < 1, "the route's length");
    const legacyAid3 = legacyReads.schedule.stops.find((stop) => stop.checkpointId === "aid-3")!;
    assert.equal(legacyAid3.movingElapsedSeconds, lastAid.elapsedSeconds, "legacy: aid-3 keeps its own ETA");
    assert.deepEqual(legacyReads.schedule.stops, schedule.stops, "legacy: the same schedule");
    withinASecond(
      sinceStart(legacyReads.projection.etaFinishPlanIso, raceStartAt),
      noFinish.expectedFinishElapsedSeconds + 4 * 120,
      "legacy: projection"
    );
  });
});

test("a finish waypoint more than 1% short of the route's end, marked by its id or title, is the finish: the schedule and the projection read one finish", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-short-finish";
    const raceStartAt = iso(wholeSecond(Date.now() + 3 * DAY));
    const fixture = load50kCourseWithAids().checkpoints;
    for (const marks of [
      { id: "finish", title: "Finish" },
      { id: "line", title: "FINISH" }
    ]) {
      const label = `finish ${marks.id} "${marks.title}", 750 m short`;
      // The finish waypoint 750 m (1.5%) before the route's end; the server projects its distance.
      const checkpoints = fixture.map((checkpoint) => {
        if (checkpoint.id !== "finish") return checkpoint;
        const { distanceMetersFromStart: _projected, ...rest } = checkpoint;
        return { ...rest, ...marks, ...pointOn50kRouteBeforeEnd(750) };
      });
      const roomId = await paidRace(app, runner, raceStartAt, checkpoints);
      const finishRow = async (stage: string) => {
        const { projection, schedule, room } = await raceReads(app, roomId, runner);
        const finish = room.course!.checkpoints.at(-1)!;
        assert.equal(finish.id, marks.id);
        assert.equal(withinCourseLength(finish.distanceMetersFromStart!, projection.courseLengthMeters), false, `${label}: more than 1% short`);
        const row = schedule.stops.at(-1)!;
        assert.equal(row.checkpointId, marks.id, `${label}, ${stage}: the finish row`);
        const finishSeconds = sinceStart(projection.etaFinishPlanIso, raceStartAt);
        // The four stops before the finish, not the finish's own.
        withinASecond(row.elapsedSeconds, (row.movingElapsedSeconds ?? NaN) + 4 * 120, `${label}, ${stage}: the stops before it`);
        withinASecond(scheduleFinishSeconds(schedule, raceStartAt), finishSeconds, `${label}, ${stage}: one finish`);
        return { row, finishSeconds, room, courseLengthMeters: projection.courseLengthMeters };
      };

      // No plan: the plan curve read at the route's end, on both.
      const noPlan = await finishRow("no plan");
      withinASecond(noPlan.finishSeconds, plannedFinishSeconds(noPlan.room, noPlan.courseLengthMeters), `${label}: the curve at the route's end`);

      const computed = await app.inject({ method: "POST", url: "/pacing-estimates", payload: { roomId }, headers: auth(app, runner) });
      assert.equal(computed.statusCode, 200, computed.body);
      const plan = computed.json() as PacingEstimate;
      const attach = await app.inject({
        method: "PUT",
        url: `/race-rooms/${roomId}/pacing-estimate`,
        payload: { pacingEstimateId: plan.id },
        headers: auth(app, runner)
      });
      assert.equal(attach.statusCode, 200, attach.body);
      const withPlan = await finishRow("plan attached");
      assert.equal(withPlan.row.movingElapsedSeconds, plan.expectedFinishElapsedSeconds, `${label}: the finish row is the plan's finish`);
      withinASecond(withPlan.finishSeconds, plan.expectedFinishElapsedSeconds + 4 * 120, `${label}: the projection's finish`);
    }
  });
});

/** The plan's clocks are its start plus its elapsed seconds, as the estimator writes them. */
function assertPlanClocksAt(estimate: PacingEstimate, raceStartAt: string, label: string): void {
  const startMs = Date.parse(raceStartAt);
  assert.equal(estimate.expectedFinishAt, iso(startMs + estimate.expectedFinishElapsedSeconds * 1000), `${label}: finish`);
  for (const [kind, band] of Object.entries(estimate.bands ?? {})) {
    assert.equal(band!.finishAt, iso(startMs + band!.finishElapsedSeconds * 1000), `${label}: ${kind} band`);
  }
  for (const eta of estimate.aidEtas) {
    assert.equal(eta.clockArrivalAt, iso(startMs + eta.elapsedSeconds * 1000), `${label}: ${eta.checkpointId}`);
  }
}

test("PATCH race-start: the runner moves the start, and the projection, schedule and plan clocks move with it", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-patch";
    const raceStartMs = wholeSecond(Date.now() + 3 * DAY);
    const raceStartAt = iso(raceStartMs);
    const roomId = await paidRace(app, runner, raceStartAt);
    const computed = await app.inject({ method: "POST", url: "/pacing-estimates", payload: { roomId }, headers: auth(app, runner) });
    assert.equal(computed.statusCode, 200, computed.body);
    const plan = computed.json() as PacingEstimate;
    assert.ok(plan.aidEtas.length > 0 && plan.bands, "a plan with aid ETAs and bands");
    const attach = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/pacing-estimate`,
      payload: { pacingEstimateId: plan.id },
      headers: auth(app, runner)
    });
    assert.equal(attach.statusCode, 200, attach.body);
    const before = await raceReads(app, roomId, runner);
    assertPlanClocksAt(before.room.pacingEstimate!, raceStartAt, "as computed");

    const laterStart = iso(raceStartMs + 90 * MINUTE);
    const patched = await patchStart(app, roomId, runner, laterStart);
    assert.equal(patched.statusCode, 200, patched.body);
    const body = patched.json() as RaceRoom;
    assert.equal(body.id, roomId);
    assert.equal(body.raceStartAt, laterStart);
    assert.equal(body.activatedAt, laterStart, "the legacy anchor moves with it, as on a course save");
    assert.ok(body.course?.baselineTrack, "a paid room goes out whole");
    assert.deepEqual(body.course?.checkpoints, before.room.course?.checkpoints, "the course is untouched");
    // The plan's elapsed times stay; its clocks are the new start plus them.
    assertPlanClocksAt(body.pacingEstimate!, laterStart, "the reply");
    assert.equal(body.pacingEstimate!.expectedFinishElapsedSeconds, plan.expectedFinishElapsedSeconds);
    assert.deepEqual(
      body.pacingEstimate!.aidEtas.map((eta) => eta.elapsedSeconds),
      plan.aidEtas.map((eta) => eta.elapsedSeconds)
    );

    const after = await raceReads(app, roomId, runner);
    assert.equal(after.room.raceStartAt, laterStart);
    assertPlanClocksAt(after.room.pacingEstimate!, laterStart, "the stored room");
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

test("PATCH race-start: race setup editors only (a crew member is refused), a Z time only", async () => {
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

test("a test ping at the finish or at an aid station puts the runner nowhere: pings/latest sends progress 0, and no visit opens", async (t) => {
  const realNow = wholeSecond(Date.now());
  t.mock.timers.enable({ apis: ["Date"], now: realNow });
  await withApp(async (app) => {
    const runner = "runner-race-start-test-ping-places";
    const raceStartMs = realNow + 2 * HOUR;
    const roomId = await paidRace(app, runner, iso(raceStartMs));
    const before = await raceReads(app, roomId, runner);
    const checkpoints = before.room.course!.checkpoints;
    const finish = checkpoints.find((checkpoint) => checkpoint.id === "finish")!;
    const aid = checkpoints.find((checkpoint) => checkpoint.id === "aid-1")!;
    // The finish line (a point-to-point course's shuttle lot), then aid-1 twice, ten minutes apart:
    // inside its radius both times, which for race pings would open a visit there.
    const places = [finish, aid, aid];
    for (const [index, place] of places.entries()) {
      t.mock.timers.setTime(realNow + index * 10 * MINUTE);
      const sent = await ping(app, roomId, runner, place, Date.now());
      assert.equal(sent.statusCode, 201, sent.body);
      const dot = (await latest(app, roomId, runner)).ping!;
      assert.equal(dot.preStart, true, place.id);
      // A client snaps a ping with no progressMeters to its nearest checkpoint: at the finish that
      // would read as a finished race on every crew phone.
      assert.equal(dot.progressMeters, 0, `${place.id}: never ${place.distanceMetersFromStart} m`);
      assert.equal(dot.latitude, place.latitude, "the dot is where the ping was");
    }
    const after = await raceReads(app, roomId, runner);
    assert.deepEqual(after.projection, before.projection, "no progress, crossing, visit or stop");
    assert.deepEqual(after.schedule, before.schedule);
    assert.ok(after.projection.checkpointSplits.every((row) => row.visits.length === 0));
    assert.deepEqual(after.projection.checkpointSplits.slice(1).map((row) => row.crossedAtRecordedAt), [null, null, null, null]);
    assert.deepEqual((await track(app, roomId, runner)).map((point) => point.preStart), [true, true, true]);
  });
});

test("a start delayed past race pings that made a closed auto visit: projection and schedule equal a clean room's, crew check-ins kept", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-delayed-visit";
    const now = wholeSecond(Date.now());
    const raceStartMs = now - 20 * MINUTE;
    const delayedAt = iso(now + HOUR);
    const fixture = load50kCourseWithAids();
    // The runner pings 400 m up the route, walks back into the start's radius, waits four minutes
    // there, and walks out: a closed auto visit at the start, a 240 s stop against 120 s planned.
    const samples = [
      { ...upRoute(400), recordedAt: iso(raceStartMs + 1 * MINUTE) },
      { ...START, recordedAt: iso(raceStartMs + 3 * MINUTE) },
      { ...START, recordedAt: iso(raceStartMs + 5 * MINUTE) },
      { ...START, recordedAt: iso(raceStartMs + 7 * MINUTE) },
      { ...upRoute(400), recordedAt: iso(raceStartMs + 9 * MINUTE) }
    ];
    // The crew's own check-in at aid-1: 420 s against 120 s planned.
    const crew = "crew-race-start-delayed-visit";
    const checkIn = async (roomId: string) => {
      const room = ((await get(app, `/race-rooms/${roomId}`, runner)).json() as { room: RaceRoom }).room;
      const joined = await app.inject({
        method: "POST",
        url: "/race-rooms/join-by-code",
        payload: { roomCode: room.joinCode },
        headers: auth(app, crew)
      });
      assert.equal(joined.statusCode, 200, joined.body);
      return app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/checkpoints/aid-1/manual-stop`,
        payload: { arrivalAt: iso(now - 10 * MINUTE), departureAt: iso(now - 3 * MINUTE) },
        headers: auth(app, crew)
      });
    };
    const pingedRoom = async () => {
      const roomId = await paidRace(app, runner, iso(raceStartMs));
      const uploaded = await app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/pings/batch`,
        payload: { points: samples, uploadIntervalSeconds: 30 },
        headers: auth(app, runner)
      });
      assert.equal(uploaded.statusCode, 200, uploaded.body);
      assert.deepEqual(
        (uploaded.json() as AthletePingBatchResponse).results.map((result) => result.reason ?? result.decision),
        ["accepted", "accepted", "accepted", "accepted", "accepted"]
      );
      const raced = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
      const visits = raced.checkpointSplits[0]!.visits;
      assert.equal(visits.length, 1, "an auto visit at the start");
      assert.ok(visits[0]!.autoDetected?.departureRecordedAt, "closed");
      assert.equal(visits[0]!.activeActualStopSeconds, 240);
      assert.equal(raced.stalenessThresholdSeconds, 90, "the race pings' upload interval");
      const checkedIn = await checkIn(roomId);
      assert.equal(checkedIn.statusCode, 200, checkedIn.body);
      return roomId;
    };

    // Delayed an hour on race morning, both ways the start can move.
    const patched = await pingedRoom();
    const patch = await patchStart(app, patched, runner, delayedAt);
    assert.equal(patch.statusCode, 200, patch.body);
    const resaved = await pingedRoom();
    const put = await app.inject({
      method: "PUT",
      url: `/race-rooms/${resaved}/course`,
      payload: {
        plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
        course: { checkpoints: fixture.checkpoints },
        routeOverlayLayer: fixture.routeOverlayLayer,
        raceStartAt: delayedAt
      },
      headers: auth(app, runner)
    });
    assert.equal(put.statusCode, 200, put.body);
    // The clean room: that start from the outset, the same check-in, no ping.
    const clean = await paidRace(app, runner, delayedAt);
    assert.equal((await checkIn(clean)).statusCode, 200);

    const shown = async (roomId: string) => {
      const { projection, schedule } = await raceReads(app, roomId, runner);
      const { roomId: _roomId, asOfRecordedAt: _asOf, ...rest } = projection;
      return { projection: rest, raceStartAt: schedule.raceStartAt, stops: schedule.stops };
    };
    const expected = await shown(clean);
    assert.equal(expected.projection.asOfPingId, "bootstrap");
    const aidCheckIn = expected.projection.checkpointSplits.find((row) => row.checkpointId === "aid-1")!.visits;
    assert.equal(aidCheckIn.length, 1);
    assert.equal(aidCheckIn[0]!.activeActualStopSeconds, 420);
    for (const [label, roomId] of [
      ["PATCH race-start", patched],
      ["PUT course", resaved]
    ] as const) {
      const actual = await shown(roomId);
      assert.deepEqual(actual.projection, expected.projection, `${label}: projection`);
      assert.deepEqual(actual.stops, expected.stops, `${label}: schedule`);
      assert.equal(actual.raceStartAt, expected.raceStartAt);
      assert.equal(actual.projection.stoppageSummary.remainingPlannedStopSeconds, 4 * 120, `${label}: only aid-1 is visited`);
      const dot = await latest(app, roomId, runner);
      assert.equal(dot.ping?.preStart, true, `${label}: the pings are pre-start now`);
      assert.equal(dot.ping?.progressMeters, 0);
      assert.equal(dot.stalenessThresholdSeconds, (await latest(app, clean, runner)).stalenessThresholdSeconds);
    }
  });
});

test("a start moved later than some race pings: their auto visits go, the later race pings still drive the projection", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-partly-pre-start";
    const now = wholeSecond(Date.now());
    const raceStartMs = now - 30 * MINUTE;
    const roomId = await paidRace(app, runner, iso(raceStartMs));
    // A closed auto visit at the start in the first nine minutes, then running up the route.
    const uploaded = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/pings/batch`,
      payload: {
        points: [
          { ...upRoute(400), recordedAt: iso(raceStartMs + 1 * MINUTE) },
          { ...START, recordedAt: iso(raceStartMs + 3 * MINUTE) },
          { ...START, recordedAt: iso(raceStartMs + 5 * MINUTE) },
          { ...upRoute(400), recordedAt: iso(raceStartMs + 7 * MINUTE) },
          { ...upRoute(1_000), recordedAt: iso(raceStartMs + 12 * MINUTE) },
          { ...upRoute(1_600), recordedAt: iso(raceStartMs + 17 * MINUTE) }
        ]
      },
      headers: auth(app, runner)
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const raced = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
    assert.equal(raced.checkpointSplits[0]!.visits.length, 1);

    // The gun was ten minutes later than set: the visit's pings are pre-start, the last two are not.
    const laterStart = iso(raceStartMs + 10 * MINUTE);
    assert.equal((await patchStart(app, roomId, runner, laterStart)).statusCode, 200);
    const moved = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
    assert.equal(moved.asOfPingId, raced.asOfPingId, "the last race ping still drives it");
    assert.equal(moved.progressMeters, raced.progressMeters);
    assert.deepEqual(moved.checkpointSplits[0]!.visits, [], "no visit from the pre-start pings");
    assert.equal(moved.checkpointSplits[0]!.crossedAtRecordedAt, laterStart);
    assert.equal(moved.stoppageSummary.remainingPlannedStopSeconds, 5 * 120);
  });
});

test("a course save that moves the start, with race pings, moves the start crossing and the finish as PATCH race-start does, later or earlier", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-put-moves";
    const now = wholeSecond(Date.now());
    const raceStartMs = now - 30 * MINUTE;
    const fixture = load50kCourseWithAids();
    // Two pings at the start line, then running up the route: the last two drive the projection
    // whichever way the start moves.
    const points = [
      { ...START, recordedAt: iso(raceStartMs + 1 * MINUTE) },
      { ...START, recordedAt: iso(raceStartMs + 5 * MINUTE) },
      { ...upRoute(400), recordedAt: iso(raceStartMs + 12 * MINUTE) },
      { ...upRoute(1_000), recordedAt: iso(raceStartMs + 17 * MINUTE) }
    ];
    const moveStart = (how: "PATCH race-start" | "PUT course", roomId: string, raceStartAt: string) =>
      how === "PATCH race-start"
        ? patchStart(app, roomId, runner, raceStartAt)
        : app.inject({
            method: "PUT",
            url: `/race-rooms/${roomId}/course`,
            payload: {
              plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
              course: { checkpoints: fixture.checkpoints },
              routeOverlayLayer: fixture.routeOverlayLayer,
              raceStartAt
            },
            headers: auth(app, runner)
          });

    for (const shiftMinutes of [10, -10]) {
      const movedAt = iso(raceStartMs + shiftMinutes * MINUTE);
      const shown: Record<string, unknown> = {};
      for (const how of ["PATCH race-start", "PUT course"] as const) {
        const label = `${how}, ${Math.abs(shiftMinutes)} min ${shiftMinutes > 0 ? "later" : "earlier"}`;
        const roomId = await paidRace(app, runner, iso(raceStartMs));
        const uploaded = await app.inject({
          method: "POST",
          url: `/race-rooms/${roomId}/pings/batch`,
          payload: { points, uploadIntervalSeconds: 30 },
          headers: auth(app, runner)
        });
        assert.equal(uploaded.statusCode, 200, uploaded.body);
        const before = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
        assert.equal(before.checkpointSplits[0]!.crossedAtRecordedAt, iso(raceStartMs));

        const moved = await moveStart(how, roomId, movedAt);
        assert.equal(moved.statusCode, 200, `${label}: ${moved.body}`);
        const { projection, schedule } = await raceReads(app, roomId, runner);
        const start = projection.checkpointSplits[0]!;
        assert.equal(start.crossedAtRecordedAt, movedAt, `${label}: the start crossing moves to the new start`);
        assert.equal(start.actualElapsedSecondsAtCross, 0, `${label}: crossed at 0 s`);
        assert.equal(projection.asOfPingId, before.asOfPingId, `${label}: the last race ping still drives it`);
        withinASecond(
          sinceStart(projection.etaFinishPlanIso, before.etaFinishPlanIso),
          shiftMinutes * 60,
          `${label}: the finish moves with the start`
        );
        assert.equal(schedule.raceStartAt, movedAt);
        // Each room has its own ping ids, and the age of the last ping is read at each GET.
        const { roomId: _roomId, asOfPingId: _pingId, secondsSinceLastAcceptedPing: _age, ...rest } = projection;
        shown[how] = { projection: rest, stops: schedule.stops };
      }
      assert.deepEqual(shown["PUT course"], shown["PATCH race-start"], `${shiftMinutes} min: a course save shows what PATCH race-start does`);
    }
  });
});

test("attaching an estimate computed before the start moved: its clocks are the start as it is now, its elapsed plan as computed", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-attach-moved";
    const raceStartMs = wholeSecond(Date.now() + 3 * DAY);
    const raceStartAt = iso(raceStartMs);
    const roomId = await paidRace(app, runner, raceStartAt);
    const attach = (payload: object) =>
      app.inject({ method: "PUT", url: `/race-rooms/${roomId}/pacing-estimate`, payload, headers: auth(app, runner) });
    const computed = await app.inject({ method: "POST", url: "/pacing-estimates", payload: { roomId }, headers: auth(app, runner) });
    assert.equal(computed.statusCode, 200, computed.body);
    const plan = computed.json() as PacingEstimate;
    assert.ok(plan.aidEtas.length > 0 && plan.bands, "a plan with aid ETAs and bands");
    assertPlanClocksAt(plan, raceStartAt, "as computed");

    // The plan attached, then another (a snapshot of it under another id), then the start moves.
    assert.equal((await attach({ pacingEstimateId: plan.id })).statusCode, 200);
    assert.equal((await attach({ estimate: { ...plan, id: `${plan.id}-other` } })).statusCode, 200);
    const laterStart = iso(raceStartMs + 90 * MINUTE);
    assert.equal((await patchStart(app, roomId, runner, laterStart)).statusCode, 200);

    // Re-attaching the stored plan (its clocks at the old start), then a snapshot of it.
    for (const [label, payload] of [
      ["re-attach by id", { pacingEstimateId: plan.id }],
      ["a snapshot", { estimate: { ...plan, id: `${plan.id}-snapshot` } }]
    ] as const) {
      const attached = await attach(payload);
      assert.equal(attached.statusCode, 200, `${label}: ${attached.body}`);
      assertPlanClocksAt((attached.json() as { estimate: PacingEstimate }).estimate, laterStart, `${label}: the reply`);
      const { room, schedule } = await raceReads(app, roomId, runner);
      const planOfRecord = room.pacingEstimate!;
      assertPlanClocksAt(planOfRecord, laterStart, `${label}: the plan of record`);
      assert.equal(planOfRecord.expectedFinishElapsedSeconds, plan.expectedFinishElapsedSeconds, `${label}: the elapsed plan stays`);
      assert.deepEqual(
        planOfRecord.aidEtas.map((eta) => eta.elapsedSeconds),
        plan.aidEtas.map((eta) => eta.elapsedSeconds)
      );
      // The schedule's aid rows are the plan's aid clocks.
      for (const eta of planOfRecord.aidEtas) {
        const row = schedule.stops.find((stop) => stop.checkpointId === eta.checkpointId)!;
        assert.equal(row.movingElapsedSeconds, eta.elapsedSeconds);
      }
    }
  });
});

test("a stored projection that pings now pre-start drove (stored before they were ignored) is re-seeded by the race's first ping", async (t) => {
  const realNow = wholeSecond(Date.now());
  t.mock.timers.enable({ apis: ["Date"], now: realNow });
  await withApp(async (app) => {
    const runner = "runner-race-start-legacy-state";
    const oldStartMs = realNow - 20 * MINUTE;
    const roomId = await paidRace(app, runner, iso(oldStartMs));
    const uploaded = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/pings/batch`,
      payload: {
        points: [
          { ...upRoute(400), recordedAt: iso(oldStartMs + 1 * MINUTE) },
          { ...START, recordedAt: iso(oldStartMs + 3 * MINUTE) },
          { ...START, recordedAt: iso(oldStartMs + 5 * MINUTE) },
          { ...upRoute(400), recordedAt: iso(oldStartMs + 7 * MINUTE) }
        ]
      },
      headers: auth(app, runner)
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const tested = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
    assert.equal(tested.checkpointSplits[0]!.visits.length, 1, "a closed auto visit at the start");

    // The start moves later than every ping with no recompute, as in a room stored before
    // pre-start pings were ignored: the stored projection is the pings'.
    const raceStartMs = realNow + HOUR;
    await commitRaceRoomUpdate(roomId, (latest) => ({ ...latest, raceStartAt: iso(raceStartMs), activatedAt: iso(raceStartMs) }));

    // A minute after the gun, at the start line: the race's first ping.
    t.mock.timers.setTime(raceStartMs + MINUTE);
    const first = await ping(app, roomId, runner, START, Date.now());
    assert.equal(first.statusCode, 201, first.body);
    const raced = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
    assert.equal(raced.asOfPingId, (first.json() as { pingId: string }).pingId);
    assert.deepEqual(raced.checkpointSplits[0]!.visits, [], "no visit from the test pings");
    assert.equal(raced.checkpointSplits[0]!.crossedAtRecordedAt, iso(raceStartMs), "the start is crossed at the start");
    assert.ok(raced.progressMeters < 50, `at the start line: ${raced.progressMeters} m`);
    assert.equal(raced.stoppageSummary.remainingPlannedStopSeconds, 5 * 120);
  });
});

test("a stored projection that pings now pre-start drove (stored before they were ignored) is re-seeded on read: it equals a clean room's, crew check-ins kept", async (t) => {
  const realNow = wholeSecond(Date.now());
  t.mock.timers.enable({ apis: ["Date"], now: realNow });
  await withApp(async (app) => {
    const runner = "runner-race-start-stale-read";
    const crew = "crew-race-start-stale-read";
    const oldStartMs = realNow - 20 * MINUTE;
    const raceStartMs = realNow + HOUR;
    const checkIn = async (roomId: string) => {
      const room = ((await get(app, `/race-rooms/${roomId}`, runner)).json() as { room: RaceRoom }).room;
      const joined = await app.inject({
        method: "POST",
        url: "/race-rooms/join-by-code",
        payload: { roomCode: room.joinCode },
        headers: auth(app, crew)
      });
      assert.equal(joined.statusCode, 200, joined.body);
      const checkedIn = await app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/checkpoints/aid-1/manual-stop`,
        payload: { arrivalAt: iso(realNow - 10 * MINUTE), departureAt: iso(realNow - 3 * MINUTE) },
        headers: auth(app, crew)
      });
      assert.equal(checkedIn.statusCode, 200, checkedIn.body);
    };

    // A runner's pings fold into the projection: a closed auto visit at the start, and a 30 s
    // upload interval. The crew checks in at aid-1.
    const roomId = await paidRace(app, runner, iso(oldStartMs));
    const uploaded = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/pings/batch`,
      payload: {
        points: [
          { ...upRoute(400), recordedAt: iso(oldStartMs + 1 * MINUTE) },
          { ...START, recordedAt: iso(oldStartMs + 3 * MINUTE) },
          { ...START, recordedAt: iso(oldStartMs + 5 * MINUTE) },
          { ...upRoute(400), recordedAt: iso(oldStartMs + 7 * MINUTE) }
        ],
        uploadIntervalSeconds: 30
      },
      headers: auth(app, runner)
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    await checkIn(roomId);
    const tested = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
    assert.equal(tested.checkpointSplits[0]!.visits.length, 1, "a closed auto visit at the start");
    assert.notEqual(tested.asOfPingId, "bootstrap");

    // The start moves later than every ping with no recompute, as in a race stored before
    // pre-start pings were ignored: the stored projection is the test pings'.
    await commitRaceRoomUpdate(roomId, (latest) => ({ ...latest, raceStartAt: iso(raceStartMs), activatedAt: iso(raceStartMs) }));

    // The clean room: that start from the outset, the same check-in, no ping.
    const clean = await paidRace(app, runner, iso(raceStartMs));
    await checkIn(clean);
    const shown = async (id: string) => {
      const { projection, schedule } = await raceReads(app, id, runner);
      const { roomId: _roomId, asOfRecordedAt: _asOf, ...rest } = projection;
      return { projection: rest, stops: schedule.stops };
    };
    const expected = await shown(clean);
    // The first read re-seeds it: nothing the test pings did is left.
    const actual = await shown(roomId);
    assert.equal(actual.projection.asOfPingId, "bootstrap");
    assert.deepEqual(actual.projection.checkpointSplits[0]!.visits, [], "no visit from the test pings");
    assert.deepEqual(actual.projection, expected.projection, "projection");
    assert.deepEqual(actual.stops, expected.stops, "schedule");
    const aid1 = actual.projection.checkpointSplits.find((row) => row.checkpointId === "aid-1")!.visits;
    assert.equal(aid1.length, 1, "the crew's check-in stays");
    assert.equal(aid1[0]!.activeActualStopSeconds, 420);
    assert.equal(
      (await latest(app, roomId, crew)).stalenessThresholdSeconds,
      (await latest(app, clean, crew)).stalenessThresholdSeconds,
      "no upload interval from a test ping"
    );
    // A second read finds nothing more to re-seed.
    assert.deepEqual((await shown(roomId)).projection, actual.projection);
  });
});

test("re-seeding a stale pre-start projection on read: a finished or expired race is left alone, a failed bootstrap keeps what was stored, a failed save still serves the re-seed", async (t) => {
  const realNow = wholeSecond(Date.now());
  t.mock.timers.enable({ apis: ["Date"], now: realNow });
  await withApp(async (app) => {
    const runner = "runner-race-start-stale-guards";
    const crew = "crew-race-start-stale-guards";
    const oldStartMs = realNow - 20 * MINUTE;
    /** A room whose stored projection its test pings drove, with a crew check-in at aid-1. */
    const staleRoom = async () => {
      const roomId = await paidRace(app, runner, iso(oldStartMs));
      const room = ((await get(app, `/race-rooms/${roomId}`, runner)).json() as { room: RaceRoom }).room;
      assert.equal((await app.inject({ method: "POST", url: "/race-rooms/join-by-code", payload: { roomCode: room.joinCode }, headers: auth(app, crew) })).statusCode, 200);
      const uploaded = await app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/pings/batch`,
        payload: {
          points: [
            { ...upRoute(400), recordedAt: iso(oldStartMs + 1 * MINUTE) },
            { ...START, recordedAt: iso(oldStartMs + 3 * MINUTE) },
            { ...START, recordedAt: iso(oldStartMs + 5 * MINUTE) },
            { ...upRoute(400), recordedAt: iso(oldStartMs + 7 * MINUTE) }
          ]
        },
        headers: auth(app, runner)
      });
      assert.equal(uploaded.statusCode, 200, uploaded.body);
      const checkedIn = await app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/checkpoints/aid-1/manual-stop`,
        payload: { arrivalAt: iso(realNow - 10 * MINUTE), departureAt: iso(realNow - 3 * MINUTE) },
        headers: auth(app, crew)
      });
      assert.equal(checkedIn.statusCode, 200, checkedIn.body);
      const pinged = (await getProjectionViewForRoom(roomId))!;
      assert.notEqual(pinged.asOfPingId, "bootstrap");
      const laterStart = iso(realNow + HOUR);
      await commitRaceRoomUpdate(roomId, (latest) => ({ ...latest, raceStartAt: laterStart, activatedAt: laterStart }));
      return { roomId, pinged };
    };

    // A finished race and an expired one: their reads are history, left as stored.
    for (const [label, edit] of [
      ["completed", (latest: RaceRoom): RaceRoom => ({ ...latest, status: "completed" })],
      ["expired", (latest: RaceRoom): RaceRoom => ({ ...latest, entitlement: { ...latest.entitlement, status: "expired" } })]
    ] as const) {
      const { roomId, pinged } = await staleRoom();
      await commitRaceRoomUpdate(roomId, edit);
      assert.equal((await getProjectionViewForRoom(roomId))?.asOfPingId, pinged.asOfPingId, `${label}: not re-seeded`);
    }

    // No bootstrap can be seeded (the route went away): the stored projection stays, check-in and all.
    {
      const { roomId, pinged } = await staleRoom();
      await commitRaceRoomUpdate(roomId, (latest) => {
        const { mapWorkspace: _route, ...room } = latest;
        return room;
      });
      const kept = (await getProjectionViewForRoom(roomId))!;
      assert.equal(kept.asOfPingId, pinged.asOfPingId, "kept as stored");
      assert.deepEqual(kept.checkpointSplits, pinged.checkpointSplits, "the check-in and the visits stay");
    }

    // The snapshot save fails: the read still answers, with the re-seeded projection.
    {
      const { roomId } = await staleRoom();
      setWs2SnapshotSaveFailureForTests(new Error("simulated snapshot save failure"));
      try {
        const read = await get(app, `/race-rooms/${roomId}/projection`, runner);
        assert.equal(read.statusCode, 200, read.body);
        const reseeded = read.json() as RaceRoomProjection;
        assert.equal(reseeded.asOfPingId, "bootstrap");
        assert.equal(reseeded.checkpointSplits.find((row) => row.checkpointId === "aid-1")!.visits.length, 1, "check-in kept");
      } finally {
        setWs2SnapshotSaveFailureForTests(undefined);
      }
    }
  });
});

test("a crew check-in keeps its visit index when the auto visit before it goes: a cached index never names another visit", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-visit-index";
    const crew = "crew-race-start-visit-index";
    const now = wholeSecond(Date.now());
    const raceStartMs = now - 30 * MINUTE;
    const roomId = await paidRace(app, runner, iso(raceStartMs));
    const room = ((await get(app, `/race-rooms/${roomId}`, runner)).json() as { room: RaceRoom }).room;
    const joined = await app.inject({
      method: "POST",
      url: "/race-rooms/join-by-code",
      payload: { roomCode: room.joinCode },
      headers: auth(app, crew)
    });
    assert.equal(joined.statusCode, 200, joined.body);
    const upload = async (points: Array<{ latitude: number; longitude: number; recordedAt: string }>) => {
      const uploaded = await app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/pings/batch`,
        payload: { points },
        headers: auth(app, runner)
      });
      assert.equal(uploaded.statusCode, 200, uploaded.body);
    };
    // The runner reaches the start line: an auto visit there (visit 1), with no stop timed yet.
    await upload([
      { ...upRoute(400), recordedAt: iso(raceStartMs + 1 * MINUTE) },
      { ...START, recordedAt: iso(raceStartMs + 3 * MINUTE) }
    ]);
    // The crew's check-in at the start, for a stop before the runner's pings got there: visit 2.
    const checkedIn = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/checkpoints/start/manual-stop`,
      payload: { arrivalAt: iso(raceStartMs + 10_000), departureAt: iso(raceStartMs + 40_000) },
      headers: auth(app, crew)
    });
    assert.equal(checkedIn.statusCode, 200, checkedIn.body);
    // Then up the route.
    await upload([
      { ...upRoute(400), recordedAt: iso(raceStartMs + 7 * MINUTE) },
      { ...upRoute(1_000), recordedAt: iso(raceStartMs + 12 * MINUTE) },
      { ...upRoute(1_600), recordedAt: iso(raceStartMs + 17 * MINUTE) }
    ]);
    const startVisits = async () =>
      ((await get(app, `/race-rooms/${roomId}/projection`, crew)).json() as RaceRoomProjection).checkpointSplits[0]!.visits;
    const before = await startVisits();
    assert.deepEqual(
      before.map((visit) => [visit.visitIndex, visit.resolvedSource]),
      [
        [1, "auto"],
        [2, "manual_crew"]
      ]
    );
    const resolve = (visitIndex: number, resolvedSource: "auto" | "manual_crew") =>
      app.inject({
        method: "PATCH",
        url: `/race-rooms/${roomId}/checkpoints/start/visits/${visitIndex}/resolved-source`,
        payload: { resolvedSource },
        headers: auth(app, crew)
      });

    for (const [label, moveTo] of [
      // Later than the auto visit, earlier than the last race pings: they still drive the projection.
      ["start moved past the auto visit", raceStartMs + 10 * MINUTE],
      // Later than every ping: the projection is re-seeded with the crew's check-ins only.
      ["start moved past every ping", now + HOUR]
    ] as const) {
      assert.equal((await patchStart(app, roomId, runner, iso(moveTo))).statusCode, 200, label);
      const after = await startVisits();
      assert.deepEqual(
        after.map((visit) => [visit.visitIndex, visit.resolvedSource]),
        [[2, "manual_crew"]],
        `${label}: the check-in is still visit 2`
      );
      // A crew phone's cached index 1 named the auto visit: it is gone, not the check-in.
      assert.equal((await resolve(1, "manual_crew")).statusCode, 404, `${label}: visit 1 is gone`);
      assert.equal((await resolve(2, "manual_crew")).statusCode, 200, `${label}: visit 2 is the check-in`);
    }
  });
});

test("pings/track names the start its preStart marks were judged against, so a phone can tell when to read it again", async () => {
  await withApp(async (app) => {
    const runner = "runner-race-start-track-start";
    const now = wholeSecond(Date.now());
    const raceStartAt = iso(now - 20 * MINUTE);
    const roomId = await paidRace(app, runner, raceStartAt);
    assert.equal((await ping(app, roomId, runner, upRoute(500), now - 30_000)).statusCode, 201);
    const read = async () => {
      const response = await get(app, `/race-rooms/${roomId}/pings/track`, runner);
      assert.equal(response.statusCode, 200, response.body);
      return response.json() as RaceRoomPingTrackResponse;
    };
    const first = await read();
    assert.equal(first.raceStartAt, raceStartAt);
    assert.equal(first.points[0]!.preStart, undefined);

    // The gun is delayed past the ping: the page re-marks it, under the new start it names.
    const delayedAt = iso(now + HOUR);
    assert.equal((await patchStart(app, roomId, runner, delayedAt)).statusCode, 200);
    const moved = await read();
    assert.equal(moved.raceStartAt, delayedAt);
    assert.equal(moved.points[0]!.preStart, true);
  });
});

/**
 * Runs `steps` against a fresh API process (nothing of the room in memory, so it all comes back
 * from Postgres) and returns each step's status and body.
 */
function inFreshProcess(steps: Array<{ method: string; url: string; user: string; payload?: unknown }>) {
  const script = `
    const { buildApp } = await import(process.argv[1]);
    const steps = JSON.parse(process.argv[2]);
    const app = buildApp();
    await app.ready();
    const out = [];
    for (const step of steps) {
      const token = app.jwt.sign({ sub: step.user, teamIds: ["team-1"], roomRoles: {} });
      const res = await app.inject({
        method: step.method,
        url: step.url,
        payload: step.payload,
        headers: { authorization: "Bearer " + token }
      });
      out.push({ status: res.statusCode, body: res.json() });
    }
    process.stdout.write("\\nRESULT:" + JSON.stringify(out) + "\\n");
    await app.close();
    process.exit(0);
  `;
  return runInFreshProcess<Array<{ status: number; body: unknown }>>(script, [JSON.stringify(steps)]);
}

test(
  "a start delayed past the runner's pings still holds after an API restart: crew see a test ping at mile 0, and moving the start back re-counts it",
  { skip: getRoomPersistenceMode() !== "postgres" && "needs Postgres (test:pg)", timeout: 90_000 },
  async () => {
    const runner = "runner-race-start-restart";
    const crew = "crew-race-start-restart";
    const now = wholeSecond(Date.now());
    let roomId = "";
    let pingId = "";
    const delayedAt = iso(now + HOUR);
    let racingProgress = 0;
    let delayed: Awaited<ReturnType<typeof raceReads>> | undefined;
    await withApp(async (app) => {
      roomId = await paidRace(app, runner, iso(now - 20 * MINUTE));
      const room = (await get(app, `/race-rooms/${roomId}`, runner)).json() as { room: RaceRoom };
      const joined = await app.inject({
        method: "POST",
        url: "/race-rooms/join-by-code",
        payload: { roomCode: room.room.joinCode },
        headers: auth(app, crew)
      });
      assert.equal(joined.statusCode, 200, joined.body);

      // A race ping 2 km up the route: it drives the projection.
      const sent = await ping(app, roomId, runner, upRoute(2_000), now - 30_000);
      assert.equal(sent.statusCode, 201, sent.body);
      pingId = (sent.json() as { pingId: string }).pingId;
      const racing = await latest(app, roomId, crew);
      assert.equal(racing.ping?.preStart, undefined);
      racingProgress = racing.ping?.progressMeters ?? 0;
      assert.ok(racingProgress > 1_500, `race ping counts: ${racingProgress} m`);

      // The gun is delayed an hour, past the ping: it is a test ping now.
      assert.equal((await patchStart(app, roomId, runner, delayedAt)).statusCode, 200);
      delayed = await raceReads(app, roomId, crew);
      assert.equal(delayed.projection.asOfPingId, "bootstrap");
      assert.equal((await latest(app, roomId, crew)).ping?.preStart, true);
    });

    const earlierAt = iso(now - 30 * MINUTE);
    const [roomRes, latestRes, projectionRes, scheduleRes, trackRes, patchRes] = inFreshProcess([
      { method: "GET", url: `/race-rooms/${roomId}`, user: crew },
      { method: "GET", url: `/race-rooms/${roomId}/pings/latest`, user: crew },
      { method: "GET", url: `/race-rooms/${roomId}/projection`, user: crew },
      { method: "GET", url: `/race-rooms/${roomId}/schedule`, user: crew },
      { method: "GET", url: `/race-rooms/${roomId}/pings/track`, user: crew },
      // The start goes back before the ping: it counts for the race again.
      { method: "PATCH", url: `/race-rooms/${roomId}/race-start`, user: runner, payload: { raceStartAt: earlierAt } }
    ]);
    // A third process, so the moved-back start can only come from Postgres, not the second
    // process's memory.
    const [roomAfterRes, latestAfterRes, projectionAfterRes] = inFreshProcess([
      { method: "GET", url: `/race-rooms/${roomId}`, user: crew },
      { method: "GET", url: `/race-rooms/${roomId}/pings/latest`, user: crew },
      { method: "GET", url: `/race-rooms/${roomId}/projection`, user: crew }
    ]);

    for (const [label, res] of Object.entries({
      roomRes,
      latestRes,
      projectionRes,
      scheduleRes,
      trackRes,
      patchRes,
      roomAfterRes,
      latestAfterRes,
      projectionAfterRes
    })) {
      assert.equal(res!.status, 200, `${label}: ${JSON.stringify(res!.body)}`);
    }
    // After the restart the delayed start is still the start, and the crew's phones show the ping
    // as a test ping at the start line, not 2 km into the race.
    assert.equal((roomRes!.body as { room: RaceRoom }).room.raceStartAt, delayedAt);
    const dot = (latestRes!.body as RaceRoomLatestPingResponse).ping;
    assert.equal(dot?.pingId, pingId);
    assert.equal(dot?.preStart, true);
    assert.equal(dot?.progressMeters, 0);
    const { evaluatedAt: _evaluatedAt, ...projection } = projectionRes!.body as RaceRoomProjection;
    assert.deepEqual(projection, delayed!.projection, "the pre-race projection at the delayed start");
    assert.deepEqual(parseCrewScheduleSheet(scheduleRes!.body), delayed!.schedule);
    assert.deepEqual(
      (trackRes!.body as RaceRoomPingTrackResponse).points.map((point) => point.preStart),
      [true]
    );

    // Moving the start back is saved, and a later process re-counts the stored ping from Postgres.
    assert.equal((roomAfterRes!.body as { room: RaceRoom }).room.raceStartAt, earlierAt);
    const after = (latestAfterRes!.body as RaceRoomLatestPingResponse).ping;
    assert.equal(after?.preStart, undefined);
    assert.equal(after?.progressMeters, racingProgress);
    const reanchored = projectionAfterRes!.body as RaceRoomProjection;
    assert.equal(reanchored.asOfPingId, pingId);
    assert.equal(reanchored.checkpointSplits[0]!.crossedAtRecordedAt, earlierAt);
  }
);
