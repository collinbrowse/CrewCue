/**
 * Unpaid-race gating (runner and crew onboarding, PR 1). An unpaid race shows its runner a
 * teaser (the course and the finish ETA, no mid-course ETA at all), enforced here on the server.
 * Crew get 402 on every gated read, chat, and join until the runner pays.
 * Runs in memory and on Postgres (CI).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCrewScheduleSheet,
  type CrewScheduleSheet,
  type MapWorkspacePosition,
  type PacingEstimate,
  type RaceRoom,
  type RaceRoomProjection
} from "@crewcue/contracts";
import { geodesicDistanceMeters, geodesicPolylineLength } from "@crewcue/map-core";
import { buildApp } from "../app.js";
import { forgetIdempotencyRecordForTests } from "../lib/httpIdempotency.js";
import {
  getPacingEstimateById,
  resetPacingEstimateStoreForTests,
  saveLegacyPacingEstimateForTests,
  savePacingEstimate
} from "../lib/pacingEstimateStore.js";
import { finishCheckpointIndex } from "../lib/raceProjection.js";
import { deleteRaceRoomAndData } from "../lib/raceRoomDeletion.js";
import { courseLengthOf, courseLengthsMatch } from "../lib/raceTeaser.js";
import { load50kCourseWithAids, pointOn50kRouteBeforeEnd } from "../lib/testCourseRouteLayer.js";
import {
  commitRaceRoomUpdate,
  getRaceRoom,
  refreshProjectionAfterPlanOfRecordChange,
  resolveRouteMetricPointsFromRaceRoomExport
} from "./raceRooms.js";

type App = ReturnType<typeof buildApp>;

// Ahead of today: a paid race 48 h past its start is locked (lib/raceLock.ts), and tests here move it.
const RACE_START_AT = "2030-08-15T13:00:00.000Z";
const ALL_CHECKPOINTS = ["start", "aid-1", "aid-2", "aid-3", "finish"];
const MID_COURSE = ["aid-1", "aid-2", "aid-3"];
const UNPAID_BODY = { error: "Race not unlocked", code: "room_unpaid" };

function token(app: App, sub: string): string {
  return app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} });
}

function auth(app: App, sub: string) {
  return { authorization: `Bearer ${token(app, sub)}` };
}

/**
 * The 50k fixture with aid tags chosen so position would pick the wrong stop: `aid-1` is a
 * water stop, the start is also tagged `aid`, and the first real aid station is `aid-2`.
 */
function taggedCourse() {
  const fixture = load50kCourseWithAids();
  const tags: Record<string, Array<"aid" | "water">> = {
    start: ["aid"],
    "aid-1": ["water"],
    "aid-2": ["aid"],
    "aid-3": ["aid"],
    finish: ["aid"]
  };
  return {
    ...fixture,
    checkpoints: fixture.checkpoints.map((checkpoint) => ({ ...checkpoint, tags: tags[checkpoint.id] ?? [] }))
  };
}

const clock = (elapsedSeconds: number) => new Date(Date.parse(RACE_START_AT) + elapsedSeconds * 1000).toISOString();

/** The fixture plan's mid-course ETAs. None of them may show anywhere while the race is unpaid. */
const MID_COURSE_ETAS = [
  { checkpointId: "aid-1", clockArrivalAt: clock(6_000), elapsedSeconds: 6_000 },
  { checkpointId: "aid-2", clockArrivalAt: clock(12_000), elapsedSeconds: 12_000 },
  // Off the straight line from start to finish, so an interpolated row cannot pass for it.
  { checkpointId: "aid-3", clockArrivalAt: clock(24_000), elapsedSeconds: 24_000 }
];
const LEAKED_VALUES = new Set<unknown>(MID_COURSE_ETAS.flatMap((eta) => [eta.elapsedSeconds, eta.clockArrivalAt]));

function estimateFor(id: string): PacingEstimate {
  return {
    id,
    coldStart: true,
    expectedFinishAt: clock(30_000),
    expectedFinishElapsedSeconds: 30_000,
    aidEtas: MID_COURSE_ETAS.map((eta) => ({ ...eta })),
    explanation: "Teaser fixture"
  };
}

/**
 * A plan the server computed for `roomId`, as `POST /pacing-estimates` stores it (whole, tied to
 * the room, for its current course length), with the fixture's fixed ETAs so tests can look for them.
 */
async function serverPlan(owner: string, roomId: string, id = `teaser-estimate-${roomId}`): Promise<PacingEstimate> {
  const estimate = estimateFor(id);
  const room = await getRaceRoom(roomId);
  const courseLengthMeters = room ? lengthOf(room) : undefined;
  assert.ok(courseLengthMeters, "serverPlan needs the race's course saved first");
  await savePacingEstimate(owner, estimate, undefined, { roomId, courseLengthMeters });
  return estimate;
}

/** A race's course length as its projection and an unpaid compute read it. */
const lengthOf = (room: RaceRoom) => courseLengthOf(room, resolveRouteMetricPointsFromRaceRoomExport(room));

/** A runner's race, set up while unpaid: create, course, plan of record. */
async function setUpUnpaidRace(app: App, runner: string, name = "Teaser 50k"): Promise<{ id: string; joinCode: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: runner, name, creatorRole: "athlete" },
    headers: auth(app, runner)
  });
  assert.equal(created.statusCode, 201);
  const room = created.json() as { id: string; joinCode: string; entitlement: { status: string } };
  assert.equal(room.entitlement.status, "unpaid");
  await setUpCourseAndPlan(app, room.id, runner);
  return room;
}

/** Course (with its route), as the runner saves it. */
async function saveCourse(app: App, roomId: string, runner: string): Promise<void> {
  const course = taggedCourse();
  const courseSave = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: course.plannedPaceSecondsPerKm,
      course: { checkpoints: course.checkpoints },
      routeOverlayLayer: course.routeOverlayLayer,
      raceStartAt: RACE_START_AT
    },
    headers: auth(app, runner)
  });
  assert.equal(courseSave.statusCode, 200, courseSave.body);
}

function attachById(app: App, roomId: string, user: string, pacingEstimateId: string) {
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/pacing-estimate`,
    payload: { pacingEstimateId },
    headers: auth(app, user)
  });
}

/** Course and plan of record on an existing race: the server computes the plan, the runner attaches it by id. */
async function setUpCourseAndPlan(app: App, roomId: string, runner: string): Promise<void> {
  await saveCourse(app, roomId, runner);
  const plan = await serverPlan(runner, roomId);
  const attach = await attachById(app, roomId, runner, plan.id);
  assert.equal(attach.statusCode, 200, attach.body);
}

async function pay(app: App, roomId: string, member: string, productId = "race_pass") {
  const response = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/billing/dev-purchase`,
    payload: { productId },
    headers: auth(app, member)
  });
  assert.equal(response.statusCode, 200);
}

async function setEntitlement(app: App, roomId: string, member: string, status: "paid" | "unpaid" | "expired") {
  const response = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status },
    headers: auth(app, member)
  });
  assert.equal(response.statusCode, 200);
}

async function joinByCode(app: App, code: string, user: string) {
  return app.inject({
    method: "POST",
    url: "/race-rooms/join-by-code",
    payload: { roomCode: code },
    headers: auth(app, user)
  });
}

const get = (app: App, url: string, user: string) => app.inject({ method: "GET", url, headers: auth(app, user) });

function computeForRoom(app: App, roomId: string, user: string, trigger = "auto") {
  return app.inject({
    method: "POST",
    url: "/pacing-estimates",
    payload: { roomId, trigger },
    headers: auth(app, user)
  });
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

const ETA_KEYS = [
  "clockArrivalAt",
  "elapsedSeconds",
  "movingElapsedSeconds",
  "plannedElapsedSecondsAtCross",
  "liveProjectedElapsedSeconds",
  "frozenPlanElapsedSeconds"
];

/**
 * Fails if `body` carries any of an unpaid race's plan beyond its finish: the plan curve
 * anywhere, an aid ETA, a checkpoint split or remaining ETA, an ETA on a mid-course checkpoint
 * (`midCourse`), or one of the fixture plan's mid-course ETAs under any checkpoint. For anyone but
 * the runner, no estimate at all.
 */
function assertNoPaidPlan(
  body: unknown,
  label: string,
  viewer: "runner" | "other",
  midCourse: ReadonlySet<string> = new Set(MID_COURSE)
): void {
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    assert.equal(Object.hasOwn(record, "baselineTrack"), false, `${label}: plan curve at ${path}.baselineTrack`);
    if (viewer === "other") {
      assert.equal(Object.hasOwn(record, "pacingEstimate"), false, `${label}: estimate at ${path}.pacingEstimate`);
      assert.equal(Object.hasOwn(record, "aidEtas"), false, `${label}: aid ETAs at ${path}.aidEtas`);
    }
    for (const key of ["aidEtas", "checkpointSplits", "remainingCheckpointEtas"]) {
      if (Object.hasOwn(record, key)) assert.deepEqual(record[key], [], `${label}: ${path}.${key} is not empty`);
    }
    if (typeof record.checkpointId === "string" && midCourse.has(record.checkpointId)) {
      for (const key of ETA_KEYS) {
        assert.equal(Object.hasOwn(record, key), false, `${label}: ${record.checkpointId} ETA at ${path}.${key}`);
      }
    }
    for (const key of ETA_KEYS) {
      assert.equal(LEAKED_VALUES.has(record[key]), false, `${label}: a mid-course ETA at ${path}.${key}`);
    }
    for (const [key, child] of Object.entries(record)) walk(child, `${path}.${key}`);
  };
  walk(body, "$");
}

test("unpaid race: the runner sets it up and reads only the course and the finish from room, projection and schedule", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser";
    const room = await setUpUnpaidRace(app, runner);

    const roomRead = await get(app, `/race-rooms/${room.id}`, runner);
    assert.equal(roomRead.statusCode, 200, roomRead.body);
    assertNoPaidPlan(roomRead.json(), "GET room", "runner");
    const teaserRoom = (roomRead.json() as { room: RaceRoom }).room;
    assert.equal(teaserRoom.entitlement.status, "unpaid");
    // The map still draws: geometry and the checkpoint list stay.
    assert.deepEqual(teaserRoom.course?.checkpoints.map((checkpoint) => checkpoint.id), ALL_CHECKPOINTS);
    assert.ok(teaserRoom.mapWorkspace?.layers.length, "route geometry stays for the map");
    // The plan curve would price every checkpoint, so it is withheld.
    assert.equal(teaserRoom.course?.baselineTrack, undefined);
    assert.deepEqual(teaserRoom.pacingEstimate?.aidEtas, []);
    assert.equal(teaserRoom.pacingEstimate?.expectedFinishAt, estimateFor("x").expectedFinishAt);

    const projectionRead = await get(app, `/race-rooms/${room.id}/projection`, runner);
    assert.equal(projectionRead.statusCode, 200, projectionRead.body);
    assertNoPaidPlan(projectionRead.json(), "GET projection", "runner");
    const projection = projectionRead.json() as RaceRoomProjection;
    assert.ok(projection.etaFinishPlanIso, "finish ETA stays");
    assert.ok(projection.courseLengthMeters > 0, "course-level fields stay");
    assert.deepEqual(projection.checkpointSplits, []);
    assert.deepEqual(projection.remainingCheckpointEtas ?? [], []);
    assert.deepEqual(projection.locked, { checkpointIds: MID_COURSE });

    const scheduleRead = await get(app, `/race-rooms/${room.id}/schedule`, runner);
    assert.equal(scheduleRead.statusCode, 200, scheduleRead.body);
    assertNoPaidPlan(scheduleRead.json(), "GET schedule", "runner");
    const schedule = parseCrewScheduleSheet(scheduleRead.json());
    assert.deepEqual(schedule.stops.map((stop) => stop.checkpointId), ["start", "finish"]);
    assert.deepEqual(schedule.locked, { checkpointIds: MID_COURSE });

    // The runner cannot send pings for an unpaid race, one at a time or as a backlog upload:
    // progress waits for the pass.
    const ping = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/pings`,
      payload: { latitude: 39.15, longitude: -120.25, recordedAt: new Date().toISOString() },
      headers: auth(app, runner)
    });
    assert.equal(ping.statusCode, 402);
    assert.equal(Object.hasOwn(ping.json() as object, "projection"), false);
    const batch = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/pings/batch`,
      payload: { points: [{ latitude: 39.15, longitude: -120.25, recordedAt: new Date().toISOString() }] },
      headers: auth(app, runner)
    });
    assert.equal(batch.statusCode, 402, batch.body);
    assert.equal(Object.hasOwn(batch.json() as object, "projection"), false);
  });
});

test("paying unlocks the full projection, schedule and room, with no locked field and the same finish", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-paid";
    const room = await setUpUnpaidRace(app, runner);
    const teaserSchedule = parseCrewScheduleSheet((await get(app, `/race-rooms/${room.id}/schedule`, runner)).json());
    const teaserProjection = (await get(app, `/race-rooms/${room.id}/projection`, runner)).json() as RaceRoomProjection;

    await pay(app, room.id, runner);

    const fullRoom = ((await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom }).room;
    assert.ok(fullRoom.course?.baselineTrack, "the plan curve comes back once paid");
    assert.deepEqual(fullRoom.pacingEstimate?.aidEtas, MID_COURSE_ETAS);

    const projectionRead = await get(app, `/race-rooms/${room.id}/projection`, runner);
    assert.equal(projectionRead.statusCode, 200);
    const projection = projectionRead.json() as RaceRoomProjection;
    assert.equal(Object.hasOwn(projection, "locked"), false);
    assert.deepEqual(projection.checkpointSplits.map((row) => row.checkpointId), ALL_CHECKPOINTS);
    assert.equal(projection.etaFinishPlanIso, teaserProjection.etaFinishPlanIso, "the teaser shows the real finish");

    const scheduleRead = await get(app, `/race-rooms/${room.id}/schedule`, runner);
    assert.equal(scheduleRead.statusCode, 200);
    const raw = scheduleRead.json() as CrewScheduleSheet;
    assert.equal(Object.hasOwn(raw, "locked"), false);
    const schedule = parseCrewScheduleSheet(raw);
    assert.deepEqual(schedule.stops.map((stop) => stop.checkpointId), ALL_CHECKPOINTS);
    for (const shown of teaserSchedule.stops) {
      assert.deepEqual(
        schedule.stops.find((stop) => stop.checkpointId === shown.checkpointId),
        shown,
        `teaser stop ${shown.checkpointId} matches the paid sheet`
      );
    }

    // Crew can now join and see the same full race.
    assert.equal((await joinByCode(app, room.joinCode, "crew-teaser-paid")).statusCode, 200);
    const crewSchedule = parseCrewScheduleSheet((await get(app, `/race-rooms/${room.id}/schedule`, "crew-teaser-paid")).json());
    assert.deepEqual(crewSchedule, schedule);
  });
});

test("paying unlocks the same finish on a course with no finish waypoint, and on one whose finish waypoint is short of the route's end", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-paid-short-course";
    const raceStartAt = futureStart();
    const fixture = taggedCourse().checkpoints;
    const courses = [
      // The route runs on 15 km past aid-3: no checkpoint is the finish line, every stop is on the
      // way there, aid-3's too.
      { course: "no finish waypoint", checkpoints: fixture.filter((checkpoint) => checkpoint.id !== "finish"), last: "aid-3" },
      // Past the 1% tolerance, still the finish by its name: its own stop is after the line.
      {
        course: "a finish waypoint 750 m short of the route's end",
        checkpoints: fixture.map((checkpoint) => {
          if (checkpoint.id !== "finish") return checkpoint;
          const { distanceMetersFromStart: _projected, ...rest } = checkpoint;
          return { ...rest, ...pointOn50kRouteBeforeEnd(750) };
        }),
        last: "finish"
      }
    ];
    for (const { course, checkpoints, last } of courses) {
      const midCourse = new Set(checkpoints.map((checkpoint) => checkpoint.id).filter((id) => id !== "start" && id !== last));
      for (const withPlan of [false, true]) {
        const label = `${course}, ${withPlan ? "plan attached" : "no plan"}`;
        const roomId = await raceWithCourse(app, runner, label, { raceStartAt, checkpoints });
        let plan: PacingEstimate | undefined;
        if (withPlan) {
          const computed = await computeForRoom(app, roomId, runner);
          assert.equal(computed.statusCode, 200, `${label}: ${computed.body}`);
          plan = computed.json() as PacingEstimate;
          assert.equal((await attachById(app, roomId, runner, plan.id)).statusCode, 200);
        }
        const unpaid = await teaserFinishes(app, roomId, runner, raceStartAt, label, midCourse);
        assert.deepEqual(unpaid.stops, ["start", last]);
        assertOneFinish(unpaid, label, plan?.expectedFinishElapsedSeconds);
        const teaserSchedule = parseCrewScheduleSheet((await get(app, `/race-rooms/${roomId}/schedule`, runner)).json());
        const stopSeconds = checkpoints.reduce((sum, checkpoint) => sum + (checkpoint.plannedStopSeconds ?? 0), 0);
        // Every planned stop but a finish checkpoint's own.
        assert.equal(unpaid.plannedStops, last === "finish" ? stopSeconds - 120 : stopSeconds, `${label}: the stops before the finish`);

        await pay(app, roomId, runner);
        const paid = await teaserFinishes(app, roomId, runner, raceStartAt, `${label}, paid`, undefined, undefined, false);
        withinASecond(paid.projection, unpaid.projection, `${label}: paying shows the same finish`);
        withinASecond(unpaid.schedule, paid.projection, `${label}: the teaser's finish row is the paid finish`);
        const paidSchedule = parseCrewScheduleSheet((await get(app, `/race-rooms/${roomId}/schedule`, runner)).json());
        assert.deepEqual(paidSchedule.stops[0], teaserSchedule.stops[0], `${label}: the start row`);
        if (last === "finish") {
          // The paid finish row is the same finish.
          withinASecond(paid.schedule, unpaid.schedule, `${label}: unpaid vs paid finish row`);
        } else {
          // No finish row once paid (aid-3 is an aid station again, at its own ETA): the finish is
          // the projection's.
          assert.equal(paid.stops.at(-1), "aid-3");
          assert.ok(paid.schedule < paid.projection - 600, `${label}: aid-3 at its own ETA, ${paid.schedule} vs ${paid.projection}`);
        }
      }
    }
  });
});

test("unpaid race: a crew member gets 402 on every gated read and write, chat included", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-crew";
    const crew = "crew-teaser-crew";
    const room = await setUpUnpaidRace(app, runner);
    // Crew can only be on an unpaid race from before it was unpaid (a refund).
    await setEntitlement(app, room.id, runner, "paid");
    assert.equal((await joinByCode(app, room.joinCode, crew)).statusCode, 200);
    await setEntitlement(app, room.id, runner, "unpaid");

    for (const url of [`/race-rooms/${room.id}`, `/race-rooms/${room.id}/projection`, `/race-rooms/${room.id}/schedule`]) {
      const response = await get(app, url, crew);
      assert.equal(response.statusCode, 402, `crew GET ${url}`);
      assert.equal(Object.hasOwn(response.json() as object, "locked"), false);
    }
    const attach = await app.inject({
      method: "PUT",
      url: `/race-rooms/${room.id}/pacing-estimate`,
      payload: { estimate: estimateFor(`crew-estimate-${room.id}`), trigger: "recalculate" },
      headers: auth(app, crew)
    });
    assert.equal(attach.statusCode, 402);

    const chatRead = await get(app, `/chat/rooms/${room.id}/messages`, crew);
    assert.equal(chatRead.statusCode, 402);
    assert.deepEqual(chatRead.json(), UNPAID_BODY);
    const chatSend = await app.inject({
      method: "POST",
      url: `/chat/rooms/${room.id}/messages`,
      payload: { clientMessageId: "crew-unpaid-1", text: "anyone here?" },
      headers: auth(app, crew)
    });
    assert.equal(chatSend.statusCode, 402);
    assert.deepEqual(chatSend.json(), UNPAID_BODY);
  });
});

test("unpaid race: a creator who is not the runner gets no teaser", async () => {
  await withApp(async (app) => {
    const manager = "manager-teaser";
    const created = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: { teamId: "team-1", athleteId: "athlete-teaser-elsewhere", name: "Managed", creatorRole: "team_manager" },
      headers: auth(app, manager)
    });
    assert.equal(created.statusCode, 201);
    const roomId = (created.json() as { id: string }).id;
    const course = taggedCourse();
    const courseSave = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/course`,
      payload: {
        plannedPaceSecondsPerKm: course.plannedPaceSecondsPerKm,
        course: { checkpoints: course.checkpoints },
        routeOverlayLayer: course.routeOverlayLayer,
        raceStartAt: RACE_START_AT
      },
      headers: auth(app, manager)
    });
    assert.equal(courseSave.statusCode, 402);
    for (const url of [`/race-rooms/${roomId}`, `/race-rooms/${roomId}/projection`, `/race-rooms/${roomId}/schedule`]) {
      assert.equal((await get(app, url, manager)).statusCode, 402, `manager GET ${url}`);
    }
  });
});

test("expired race stays blocked for the runner too", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-expired";
    const room = await setUpUnpaidRace(app, runner);
    await setEntitlement(app, room.id, runner, "expired");
    for (const url of [`/race-rooms/${room.id}`, `/race-rooms/${room.id}/projection`, `/race-rooms/${room.id}/schedule`]) {
      assert.equal((await get(app, url, runner)).statusCode, 403, `runner GET ${url}`);
    }
  });
});

test("unpaid race: invites, invite accept and join-by-code return 402 room_unpaid; the runner still joins", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-joins";
    const room = await setUpUnpaidRace(app, runner);

    const invite = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/invites`,
      payload: { email: "crew@example.com", role: "crew_member" },
      headers: auth(app, runner)
    });
    assert.equal(invite.statusCode, 402);
    assert.deepEqual(invite.json(), UNPAID_BODY);

    const join = await joinByCode(app, room.joinCode, "crew-teaser-join");
    assert.equal(join.statusCode, 402);
    assert.deepEqual(join.json(), UNPAID_BODY);

    // An invite issued while paid is refused on accept once the race is unpaid again.
    await setEntitlement(app, room.id, runner, "paid");
    const issued = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/invites`,
      payload: { email: "later@example.com", role: "crew_member" },
      headers: auth(app, runner)
    });
    assert.equal(issued.statusCode, 201);
    await setEntitlement(app, room.id, runner, "unpaid");
    const accept = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/invites/accept`,
      payload: { token: (issued.json() as { token: string }).token },
      headers: auth(app, "crew-teaser-accept")
    });
    assert.equal(accept.statusCode, 402);
    assert.deepEqual(accept.json(), UNPAID_BODY);

    // Nobody was added, and the refusal is not a crew-cap upsell.
    const billing = (await get(app, `/race-rooms/${room.id}/billing`, runner)).json() as {
      crewCount: number;
      offers: string[];
    };
    assert.equal(billing.crewCount, 0);
    assert.deepEqual(billing.offers, ["race_pass", "race_pass_full_crew"]);
  });
});

test("unpaid race created for a runner: the runner still joins their own race by code", async () => {
  await withApp(async (app) => {
    const manager = "manager-for-runner";
    const runner = "runner-joins-own";
    const created = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: { teamId: "team-1", athleteId: runner, name: "For the runner", creatorRole: "team_manager" },
      headers: auth(app, manager)
    });
    assert.equal(created.statusCode, 201);
    const room = created.json() as { id: string; joinCode: string };
    const join = await joinByCode(app, room.joinCode, runner);
    assert.equal(join.statusCode, 200, join.body);
    assert.equal((await get(app, `/race-rooms/${room.id}`, runner)).statusCode, 200);
    assert.equal((await joinByCode(app, room.joinCode, "crew-for-runner")).statusCode, 402);
  });
});

/** An unpaid race with a crew member left over from when it was paid (a refund). */
async function setUpRefundedRace(app: App, runner: string, crew: string) {
  const room = await setUpUnpaidRace(app, runner);
  await setEntitlement(app, room.id, runner, "paid");
  assert.equal((await joinByCode(app, room.joinCode, crew)).statusCode, 200);
  await setEntitlement(app, room.id, runner, "unpaid");
  return room;
}

test("unpaid race: no 200 a member can get carries the plan curve or a mid-course ETA", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-sweep";
    const crew = "crew-teaser-sweep";
    const room = await setUpRefundedRace(app, runner, crew);
    const course = taggedCourse();

    // The runner's own setup and reads: each answers 200, shaped as the teaser.
    const runnerCalls: Array<{ label: string; run: () => ReturnType<typeof get> }> = [
      { label: "GET room", run: () => get(app, `/race-rooms/${room.id}`, runner) },
      { label: "GET projection", run: () => get(app, `/race-rooms/${room.id}/projection`, runner) },
      { label: "GET schedule", run: () => get(app, `/race-rooms/${room.id}/schedule`, runner) },
      { label: "GET mine", run: () => get(app, "/race-rooms/mine", runner) },
      { label: "GET team rooms", run: () => get(app, "/teams/team-1/race-rooms", runner) },
      {
        // No overlay: the attached plan is kept, so this is the re-save that used to leak it.
        label: "PUT course (re-save, plan attached)",
        run: () =>
          app.inject({
            method: "PUT",
            url: `/race-rooms/${room.id}/course`,
            payload: {
              plannedPaceSecondsPerKm: course.plannedPaceSecondsPerKm,
              course: { checkpoints: course.checkpoints },
              raceStartAt: RACE_START_AT
            },
            headers: auth(app, runner)
          })
      },
      {
        label: "PUT pacing-estimate (already attached)",
        run: () => attachById(app, room.id, runner, `teaser-estimate-${room.id}`)
      },
      { label: "join-by-code (existing member)", run: () => joinByCode(app, room.joinCode, runner) },
      {
        label: "PATCH own display name",
        run: () =>
          app.inject({
            method: "PATCH",
            url: `/race-rooms/${room.id}/members/${runner}`,
            payload: { displayName: "Runner" },
            headers: auth(app, runner)
          })
      },
      {
        label: "PATCH crew role",
        run: () =>
          app.inject({
            method: "PATCH",
            url: `/race-rooms/${room.id}/members/${crew}`,
            payload: { role: "crew_chief" },
            headers: auth(app, runner)
          })
      }
    ];
    for (const call of runnerCalls) {
      const response = await call.run();
      assert.equal(response.statusCode, 200, `runner ${call.label}: ${response.body}`);
      assertNoPaidPlan(response.json(), `runner ${call.label}`, "runner");
    }

    // The re-save kept the plan of record; the teaser shows its finish only.
    const roomRead = (await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom };
    assert.equal(roomRead.room.pacingEstimateId, `teaser-estimate-${room.id}`);
    assert.deepEqual(roomRead.room.pacingEstimate?.aidEtas, []);

    // Left-over crew: lists, rejoin and their own name answer 200 with no plan at all.
    const crewCalls: Array<{ label: string; run: () => ReturnType<typeof get> }> = [
      { label: "GET mine", run: () => get(app, "/race-rooms/mine", crew) },
      { label: "GET team rooms", run: () => get(app, "/teams/team-1/race-rooms", crew) },
      { label: "join-by-code (existing member)", run: () => joinByCode(app, room.joinCode, crew) },
      {
        label: "PATCH own display name",
        run: () =>
          app.inject({
            method: "PATCH",
            url: `/race-rooms/${room.id}/members/${crew}`,
            payload: { displayName: "Crew" },
            headers: auth(app, crew)
          })
      }
    ];
    for (const call of crewCalls) {
      const response = await call.run();
      assert.equal(response.statusCode, 200, `crew ${call.label}: ${response.body}`);
      assertNoPaidPlan(response.json(), `crew ${call.label}`, "other");
    }
    // The lists still render the race and its paywall.
    const crewMine = (await get(app, "/race-rooms/mine", crew)).json() as { rooms: RaceRoom[] };
    const listed = crewMine.rooms.find((candidate) => candidate.id === room.id);
    assert.ok(listed, "the race stays in crew's list");
    assert.equal(listed.entitlement.status, "unpaid");
    assert.equal(listed.joinCode, room.joinCode);
    assert.ok(listed.memberships.some((member) => member.userId === crew));
    assert.deepEqual(listed.course?.checkpoints.map((checkpoint) => checkpoint.id), ALL_CHECKPOINTS);

    // Removing the crew member answers the runner with the teaser too.
    const removed = await app.inject({
      method: "DELETE",
      url: `/race-rooms/${room.id}/members/${crew}`,
      headers: auth(app, runner)
    });
    assert.equal(removed.statusCode, 200);
    assertNoPaidPlan(removed.json(), "runner DELETE member", "runner");
  });
});

test("unpaid race: attaching a server-computed plan by id shows no aid ETA anywhere; paying shows them all", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-attach-id";
    const created = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: { teamId: "team-1", athleteId: runner, name: "Attach by id", creatorRole: "athlete" },
      headers: auth(app, runner)
    });
    assert.equal(created.statusCode, 201);
    const roomId = (created.json() as RaceRoom).id;
    await saveCourse(app, roomId, runner);
    const plan = await serverPlan(runner, roomId);

    const attach = await attachById(app, roomId, runner, plan.id);
    assert.equal(attach.statusCode, 200, attach.body);
    assertNoPaidPlan(attach.json(), "runner PUT pacing-estimate by id", "runner");
    const attached = attach.json() as { pacingEstimateId: string; estimate: PacingEstimate };
    assert.equal(attached.pacingEstimateId, plan.id);
    assert.deepEqual(attached.estimate.aidEtas, []);
    assert.equal(attached.estimate.expectedFinishAt, plan.expectedFinishAt, "the finish stays");

    const reads = await readTeaser(app, roomId, runner, "after attach by id");
    assert.deepEqual(reads, { aidEtas: [], splits: [], stops: ["start", "finish"], locked: MID_COURSE });

    // The stored plan is whole and now records this race.
    const stored = await getPacingEstimateById(plan.id);
    assert.deepEqual(stored?.estimate.aidEtas, MID_COURSE_ETAS);
    assert.deepEqual(stored?.roomIds, [roomId]);

    await pay(app, roomId, runner);
    const full = ((await get(app, `/race-rooms/${roomId}`, runner)).json() as { room: RaceRoom }).room;
    assert.deepEqual(full.pacingEstimate?.aidEtas, MID_COURSE_ETAS);
  });
});

test("unpaid race: an inline estimate snapshot is refused with 402 room_unpaid; nothing is attached or stored", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-inline";
    const room = await setUpUnpaidRace(app, runner);
    const snapshot = estimateFor(`inline-${room.id}`);

    for (const payload of [{ estimate: snapshot }, { estimate: snapshot, pacingEstimateId: `teaser-estimate-${room.id}` }]) {
      const response = await app.inject({
        method: "PUT",
        url: `/race-rooms/${room.id}/pacing-estimate`,
        payload,
        headers: auth(app, runner)
      });
      assert.equal(response.statusCode, 402, response.body);
      assert.deepEqual(response.json(), UNPAID_BODY);
    }
    assert.equal(await getPacingEstimateById(snapshot.id), undefined, "the snapshot is not stored");
    const after = ((await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom }).room;
    assert.equal(after.pacingEstimateId, `teaser-estimate-${room.id}`, "the plan of record is unchanged");

    // Paid races still take a snapshot.
    await pay(app, room.id, runner);
    const paid = await app.inject({
      method: "PUT",
      url: `/race-rooms/${room.id}/pacing-estimate`,
      payload: { estimate: snapshot },
      headers: auth(app, runner)
    });
    assert.equal(paid.statusCode, 200, paid.body);
    assert.deepEqual((paid.json() as { estimate: PacingEstimate }).estimate.aidEtas, MID_COURSE_ETAS);
  });
});

test("an estimate tied to an unpaid race cannot be attached to another race until that race is paid", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-cross-room";
    const unpaid = await setUpUnpaidRace(app, runner, "Unpaid 50k");
    const paid = await setUpUnpaidRace(app, runner, "Paid 50k");
    await pay(app, paid.id, runner);

    // Computed for the unpaid race: the runner saw its finish only.
    const computed = await computeForRoom(app, unpaid.id, runner);
    assert.equal(computed.statusCode, 200, computed.body);
    const computedId = (computed.json() as PacingEstimate).id;
    const planOfUnpaid = `teaser-estimate-${unpaid.id}`;

    for (const id of [computedId, planOfUnpaid]) {
      const byId = await attachById(app, paid.id, runner, id);
      assert.equal(byId.statusCode, 402, `attach ${id} by id: ${byId.body}`);
      assert.deepEqual(byId.json(), UNPAID_BODY);
    }
    // An inline snapshot reusing the id would still carry the stored plan curve onto the paid race.
    const inline = await app.inject({
      method: "PUT",
      url: `/race-rooms/${paid.id}/pacing-estimate`,
      payload: { estimate: { ...estimateFor(computedId) } },
      headers: auth(app, runner)
    });
    assert.equal(inline.statusCode, 402, inline.body);
    assert.deepEqual(inline.json(), UNPAID_BODY);

    const paidRoom = ((await get(app, `/race-rooms/${paid.id}`, runner)).json() as { room: RaceRoom }).room;
    assert.equal(paidRoom.pacingEstimateId, `teaser-estimate-${paid.id}`, "the paid race keeps its own plan");
    assert.deepEqual((await getPacingEstimateById(computedId))?.roomIds, [unpaid.id]);

    // Once the race it came from is paid, it moves freely. Attaching adds the race; none is dropped.
    await pay(app, unpaid.id, runner);
    const moved = await attachById(app, paid.id, runner, computedId);
    assert.equal(moved.statusCode, 200, moved.body);
    assert.deepEqual((await getPacingEstimateById(computedId))?.roomIds, [paid.id, unpaid.id].sort());
  });
});

test("unpaid race: POST /pacing-estimates answers the runner finish-only, stored whole; crew get 402", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-estimate";
    const crew = "crew-teaser-estimate";
    const room = await setUpRefundedRace(app, runner, crew);

    // The native client's recompute: POST /pacing-estimates, then attach by id.
    const computed = await computeForRoom(app, room.id, runner);
    assert.equal(computed.statusCode, 200, computed.body);
    const estimate = computed.json() as PacingEstimate;
    assert.deepEqual(estimate.aidEtas, []);
    assert.ok(estimate.expectedFinishAt, "the finish ETA stays");
    assertNoPaidPlan(estimate, "runner POST /pacing-estimates", "runner");
    const stored = await getPacingEstimateById(estimate.id);
    assert.deepEqual(stored?.estimate.aidEtas.map((eta) => eta.checkpointId), MID_COURSE, "stored whole");
    assert.deepEqual(stored?.roomIds, [room.id]);

    const attach = await attachById(app, room.id, runner, estimate.id);
    assert.equal(attach.statusCode, 200, attach.body);
    assertNoPaidPlan(attach.json(), "runner PUT pacing-estimate", "runner");

    for (const trigger of ["recalculate", "cold_start"]) {
      const response = await computeForRoom(app, room.id, crew, trigger);
      assert.equal(response.statusCode, 402, `crew ${trigger}: ${response.body}`);
      assert.equal(Object.hasOwn(response.json() as object, "aidEtas"), false);
    }

    // Paying unlocks every aid ETA the estimator priced: only the replies were shaped.
    await pay(app, room.id, runner);
    const full = ((await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom }).room;
    assert.equal(full.pacingEstimateId, estimate.id);
    assert.deepEqual(full.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), MID_COURSE);
    assert.ok(full.course?.baselineTrack, "the estimate's plan curve was attached");
  });
});

test("POST /pacing-estimates without a room is finish-only for everyone, stored whole", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-roomless";
    const room = await setUpUnpaidRace(app, runner);
    const paidRunner = "runner-teaser-roomless-paid";
    const paidRoom = await setUpUnpaidRace(app, paidRunner, "Paid room-less");
    await pay(app, paidRoom.id, paidRunner);
    const teaser = ((await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom }).room;

    // An unpaid race's runner posting its course, a runner whose race is paid, and someone with no race.
    for (const user of [runner, paidRunner, "someone-teaser-roomless"]) {
      const response = await app.inject({
        method: "POST",
        url: "/pacing-estimates",
        payload: { raceStartAt: RACE_START_AT, checkpoints: teaser.course?.checkpoints },
        headers: auth(app, user)
      });
      assert.equal(response.statusCode, 200, `${user}: ${response.body}`);
      const estimate = response.json() as PacingEstimate;
      assert.deepEqual(estimate.aidEtas, [], `${user}: no aid ETA`);
      assert.ok(estimate.expectedFinishAt, "the finish ETA stays");
      assertNoPaidPlan(estimate, `${user} room-less POST /pacing-estimates`, "runner");
      const stored = await getPacingEstimateById(estimate.id);
      assert.ok(stored && stored.estimate.aidEtas.length > 0, "stored whole");
      assert.deepEqual(stored?.roomIds, []);
    }
  });
});

test("GET /me/export: whole only when tied to a paid race of the caller's, finish-only otherwise", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-export";
    const room = await setUpUnpaidRace(app, runner, "Unpaid export");
    const other = await setUpUnpaidRace(app, runner, "Paid export");
    await pay(app, other.id, runner);
    const attachedId = `teaser-estimate-${room.id}`;

    const computed = await computeForRoom(app, room.id, runner);
    assert.equal(computed.statusCode, 200, computed.body);
    const computedId = (computed.json() as PacingEstimate).id;
    // Estimate ids follow their inputs, so each room-less estimate gets its own seed.
    const roomless = async (seed: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/pacing-estimates",
        payload: { raceStartAt: RACE_START_AT, checkpoints: taggedCourse().checkpoints, seed },
        headers: auth(app, runner)
      });
      assert.equal(response.statusCode, 200, response.body);
      return (response.json() as PacingEstimate).id;
    };
    const roomlessId = await roomless("export-roomless");
    // Room-less, then attached to the paid race: that race unlocks it.
    const laterAttachedId = await roomless("export-later-attached");
    assert.notEqual(laterAttachedId, roomlessId);
    assert.equal((await attachById(app, other.id, runner, laterAttachedId)).statusCode, 200);

    const exported = async () => {
      const response = await get(app, "/me/export", runner);
      assert.equal(response.statusCode, 200, response.body);
      const estimates = (response.json() as { pacingEstimates: PacingEstimate[] }).pacingEstimates;
      return {
        estimates,
        priced: (id: string) => estimates.find((estimate) => estimate.id === id)?.aidEtas.map((eta) => eta.checkpointId)
      };
    };

    const unpaid = await exported();
    assertNoPaidPlan(
      unpaid.estimates.filter((estimate) => estimate.id !== laterAttachedId && estimate.id !== `teaser-estimate-${other.id}`),
      "runner GET /me/export",
      "runner"
    );
    assert.deepEqual(unpaid.priced(computedId), [], "computed for the unpaid race");
    assert.deepEqual(unpaid.priced(attachedId), [], "the unpaid race's plan of record");
    assert.deepEqual(unpaid.priced(roomlessId), [], "room-less");
    assert.deepEqual(unpaid.priced(laterAttachedId), MID_COURSE, "room-less, later attached to a paid race");
    assert.deepEqual(unpaid.priced(`teaser-estimate-${other.id}`), MID_COURSE, "computed for the paid race");

    await pay(app, room.id, runner);
    const paid = await exported();
    assert.deepEqual(paid.priced(computedId), MID_COURSE);
    assert.deepEqual(paid.priced(attachedId), MID_COURSE);
    assert.deepEqual(paid.priced(roomlessId), [], "room-less stays finish-only");
    assert.deepEqual(paid.priced(laterAttachedId), MID_COURSE);
  });
});

test("unpaid race: an athlete-role invite is no way in, issued or left over from when it was paid", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-athlete-invite";
    const outsider = "outsider-teaser-athlete-invite";
    const room = await setUpUnpaidRace(app, runner);

    const unpaidIssue = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/invites`,
      payload: { email: "second-athlete@example.com", role: "athlete" },
      headers: auth(app, runner)
    });
    assert.equal(unpaidIssue.statusCode, 402);
    assert.deepEqual(unpaidIssue.json(), UNPAID_BODY);

    await setEntitlement(app, room.id, runner, "paid");
    const issued = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/invites`,
      payload: { email: "second-athlete@example.com", role: "athlete" },
      headers: auth(app, runner)
    });
    assert.equal(issued.statusCode, 201);
    await setEntitlement(app, room.id, runner, "unpaid");
    const accept = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/invites/accept`,
      payload: { token: (issued.json() as { token: string }).token },
      headers: auth(app, outsider)
    });
    assert.equal(accept.statusCode, 402);
    assert.deepEqual(accept.json(), UNPAID_BODY);

    // Not a member: nothing listed, nothing readable.
    const mine = (await get(app, "/race-rooms/mine", outsider)).json() as { rooms: RaceRoom[] };
    assert.equal(mine.rooms.some((candidate) => candidate.id === room.id), false);
    assert.equal((await get(app, `/race-rooms/${room.id}`, outsider)).statusCode, 403);
  });
});

test("join preview: an unpaid race sends no plan curve; a paid race is unchanged", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-preview";
    const room = await setUpUnpaidRace(app, runner);
    const preview = (url: string) => app.inject({ method: "GET", url });

    const unpaid = await preview(`/race-rooms/join-preview/${room.joinCode}`);
    assert.equal(unpaid.statusCode, 200, unpaid.body);
    const unpaidBody = unpaid.json() as { preview: { baselineTrack?: unknown; checkpoints?: Array<{ id: string }> } };
    assert.equal(Object.hasOwn(unpaidBody.preview, "baselineTrack"), false);
    assert.deepEqual(unpaidBody.preview.checkpoints?.map((checkpoint) => checkpoint.id), ALL_CHECKPOINTS);
    assertNoPaidPlan(unpaidBody, "anonymous join preview", "other");

    await pay(app, room.id, runner);
    const paid = (await preview(`/race-rooms/join-preview/${room.joinCode}`)).json() as {
      preview: { baselineTrack?: { points: unknown[] } };
    };
    assert.ok(paid.preview.baselineTrack?.points.length, "paid preview keeps the plan curve");
  });
});

type CourseCheckpoints = ReturnType<typeof taggedCourse>["checkpoints"];

/** PUT course with no route overlay: a re-save, so the attached plan of record is kept. */
function resaveCourse(
  app: App,
  roomId: string,
  user: string,
  checkpoints: CourseCheckpoints,
  idempotencyKey?: string,
  raceStartAt = RACE_START_AT
) {
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: taggedCourse().plannedPaceSecondsPerKm,
      course: { checkpoints },
      raceStartAt
    },
    headers: { ...auth(app, user), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }
  });
}

/**
 * The runner's three teaser reads of the race, each checked for the plan, and what they show:
 * the attached estimate's aid ETAs, the projection's splits and the schedule's stops.
 */
async function readTeaser(app: App, roomId: string, runner: string, label: string, midCourse?: ReadonlySet<string>) {
  const reads = {
    room: await get(app, `/race-rooms/${roomId}`, runner),
    projection: await get(app, `/race-rooms/${roomId}/projection`, runner),
    schedule: await get(app, `/race-rooms/${roomId}/schedule`, runner)
  };
  for (const [name, response] of Object.entries(reads)) {
    assert.equal(response.statusCode, 200, `${label}: GET ${name}: ${response.body}`);
    assertNoPaidPlan(response.json(), `${label}: GET ${name}`, "runner", midCourse);
  }
  const schedule = parseCrewScheduleSheet(reads.schedule.json());
  return {
    aidEtas: (reads.room.json() as { room: RaceRoom }).room.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId),
    splits: (reads.projection.json() as RaceRoomProjection).checkpointSplits.map((row) => row.checkpointId),
    stops: schedule.stops.map((stop) => stop.checkpointId),
    locked: schedule.locked?.checkpointIds
  };
}

test("unpaid race: re-tagging, deleting or moving checkpoints never reveals a mid-course ETA anywhere", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-edits";
    const room = await setUpUnpaidRace(app, runner);
    const fixture = taggedCourse().checkpoints;
    const byId = (id: string) => fixture.find((checkpoint) => checkpoint.id === id)!;
    const retag = (tags: Record<string, Array<"aid" | "water">>) =>
      fixture.map((checkpoint) => ({ ...checkpoint, tags: tags[checkpoint.id] ?? checkpoint.tags }));
    const without = (...ids: string[]) => fixture.filter((checkpoint) => !ids.includes(checkpoint.id));
    const onto = (id: string, target: string) =>
      without(target).map((checkpoint) =>
        checkpoint.id === id
          ? {
              ...checkpoint,
              latitude: byId(target).latitude,
              longitude: byId(target).longitude,
              distanceMetersFromStart: byId(target).distanceMetersFromStart
            }
          : checkpoint
      );

    // Every edit a runner can make to pick out one stop: the `aid` tag on each stop in turn, no
    // tags, a stop deleted, a stop moved onto another's spot, the real start or finish dropped
    // so a priced stop becomes the first or last row, and the full course back.
    const variants: Array<{ label: string; checkpoints: CourseCheckpoints; stops: string[] }> = [
      { label: "aid tag on aid-1", checkpoints: retag({ "aid-1": ["aid"], "aid-2": ["water"], "aid-3": ["water"] }), stops: ["start", "finish"] },
      { label: "aid tag on aid-3", checkpoints: retag({ "aid-1": ["water"], "aid-2": ["water"], "aid-3": ["aid"] }), stops: ["start", "finish"] },
      { label: "no tags", checkpoints: retag({ "aid-1": [], "aid-2": [], "aid-3": [] }), stops: ["start", "finish"] },
      { label: "aid-2 deleted", checkpoints: without("aid-2"), stops: ["start", "finish"] },
      { label: "aid-2 moved onto aid-3", checkpoints: onto("aid-2", "aid-3"), stops: ["start", "finish"] },
      { label: "start dropped", checkpoints: without("start"), stops: ["aid-1", "finish"] },
      { label: "finish dropped", checkpoints: without("finish"), stops: ["start", "aid-3"] },
      { label: "full course", checkpoints: fixture, stops: ["start", "finish"] }
    ];
    const computedIds = new Set<string>();
    for (const variant of variants) {
      const label = variant.label;
      const saved = await resaveCourse(app, room.id, runner, variant.checkpoints);
      assert.equal(saved.statusCode, 200, `${label}: ${saved.body}`);
      const ids = (saved.json() as RaceRoom).course?.checkpoints.map((checkpoint) => checkpoint.id) ?? [];
      const midCourse = new Set(ids.filter((id) => !variant.stops.includes(id)));
      assertNoPaidPlan(saved.json(), `${label}: PUT course`, "runner", midCourse);
      assert.deepEqual(await readTeaser(app, room.id, runner, label, midCourse), {
        aidEtas: [],
        splits: [],
        stops: variant.stops,
        locked: MID_COURSE.filter((id) => midCourse.has(id))
      });

      // A recompute on the edited course, and attaching it: still the finish only. Checkpoints that
      // stop short of the route's end (the finish dropped) compute too: an unpaid race reads its
      // finish at the course end, not at the last stop.
      const computed = await computeForRoom(app, room.id, runner);
      assertNoPaidPlan(computed.json(), `${label}: POST /pacing-estimates`, "runner", midCourse);
      assert.equal(computed.statusCode, 200, `${label}: ${computed.body}`);
      const attachedId = (computed.json() as PacingEstimate).id;
      computedIds.add(attachedId);
      const attach = await attachById(app, room.id, runner, attachedId);
      assert.equal(attach.statusCode, 200, `${label}: ${attach.body}`);
      assertNoPaidPlan(attach.json(), `${label}: PUT pacing-estimate`, "runner", midCourse);
      assert.deepEqual(await readTeaser(app, room.id, runner, `${label}, recomputed`, midCourse), {
        aidEtas: [],
        splits: [],
        stops: variant.stops,
        locked: MID_COURSE.filter((id) => midCourse.has(id))
      });
    }

    // Every estimate those edits produced exports finish-only.
    const exported = await get(app, "/me/export", runner);
    assert.equal(exported.statusCode, 200, exported.body);
    const estimates = (exported.json() as { pacingEstimates: PacingEstimate[] }).pacingEstimates;
    for (const id of [...computedIds, `teaser-estimate-${room.id}`]) {
      assert.ok(estimates.some((estimate) => estimate.id === id), `export lists ${id}`);
    }
    assertNoPaidPlan(exported.json(), "GET /me/export after the edits", "runner");
  });
});

test("unpaid race: a course re-saved to start or end at a priced stop does not show that stop's ETA", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-edge-rows";
    const room = await setUpUnpaidRace(app, runner);
    const fixture = taggedCourse().checkpoints;

    // aid-3 first: the stored plan prices it at 24 000 s. As the first row it is read off the
    // start and finish instead, about 21 000 s.
    const fromAid3 = fixture.filter((checkpoint) => ["aid-3", "finish"].includes(checkpoint.id));
    assert.equal((await resaveCourse(app, room.id, runner, fromAid3)).statusCode, 200);
    const startsAtAid3 = parseCrewScheduleSheet((await get(app, `/race-rooms/${room.id}/schedule`, runner)).json());
    assert.deepEqual(startsAtAid3.stops.map((stop) => stop.checkpointId), ["aid-3", "finish"]);
    const first = startsAtAid3.stops[0]!;
    assert.ok(Math.abs(first.elapsedSeconds - 21_000) < 60, `start row elapsed ${first.elapsedSeconds}`);
    assert.ok(Math.abs((first.movingElapsedSeconds ?? 0) - 21_000) < 60);

    // aid-1 last: the stored plan prices it at 6 000 s. As the last row it carries the finish.
    const toAid1 = fixture.filter((checkpoint) => ["start", "aid-1"].includes(checkpoint.id));
    assert.equal((await resaveCourse(app, room.id, runner, toAid1)).statusCode, 200);
    const endsAtAid1 = parseCrewScheduleSheet((await get(app, `/race-rooms/${room.id}/schedule`, runner)).json());
    assert.deepEqual(endsAtAid1.stops.map((stop) => stop.checkpointId), ["start", "aid-1"]);
    assert.equal(endsAtAid1.stops[1]!.movingElapsedSeconds, 30_000);

    const roomRead = (await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom };
    assert.deepEqual(roomRead.room.pacingEstimate?.aidEtas, []);
    const projection = (await get(app, `/race-rooms/${room.id}/projection`, runner)).json() as RaceRoomProjection;
    assert.deepEqual(projection.checkpointSplits, []);
  });
});

test("unpaid race: listing a mid-course stop first never moves the pre-race finish ETA off the start line", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-origin";
    // A race still to come, so the finish is not clamped to now and an origin shift would show.
    const raceStartAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const created = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: { teamId: "team-1", athleteId: runner, name: "Future 50k", creatorRole: "athlete" },
      headers: auth(app, runner)
    });
    const roomId = (created.json() as RaceRoom).id;
    const course = taggedCourse();
    const save = (checkpoints: CourseCheckpoints, withRoute: boolean) =>
      app.inject({
        method: "PUT",
        url: `/race-rooms/${roomId}/course`,
        payload: {
          plannedPaceSecondsPerKm: course.plannedPaceSecondsPerKm,
          course: { checkpoints },
          ...(withRoute ? { routeOverlayLayer: course.routeOverlayLayer } : {}),
          raceStartAt
        },
        headers: auth(app, runner)
      });
    assert.equal((await save(course.checkpoints, true)).statusCode, 200);
    const computed = await computeForRoom(app, roomId, runner);
    assert.equal((await attachById(app, roomId, runner, (computed.json() as PacingEstimate).id)).statusCode, 200);

    const finishElapsed = async (label: string) => {
      const response = await get(app, `/race-rooms/${roomId}/projection`, runner);
      assert.equal(response.statusCode, 200, `${label}: ${response.body}`);
      assertNoPaidPlan(response.json(), `${label}: GET projection`, "runner");
      return (Date.parse((response.json() as RaceRoomProjection).etaFinishPlanIso) - Date.parse(raceStartAt)) / 1000;
    };
    // The pre-race projection places the runner at the first listed checkpoint. Listing aid-N
    // first must not turn the finish into "finish from aid-N": only the dropped stops' planned
    // stoppage may change it.
    const shifted: Array<{ first: string; finish: number; droppedStops: number }> = [];
    for (const first of MID_COURSE) {
      const index = course.checkpoints.findIndex((checkpoint) => checkpoint.id === first);
      assert.equal((await save(course.checkpoints.slice(index), false)).statusCode, 200);
      const droppedStops = course.checkpoints
        .slice(0, index)
        .reduce((sum, checkpoint) => sum + (checkpoint.plannedStopSeconds ?? 0), 0);
      shifted.push({ first, finish: await finishElapsed(`${first} first`), droppedStops });
    }
    assert.equal((await save(course.checkpoints, false)).statusCode, 200);
    const fromStart = await finishElapsed("full course");
    for (const { first, finish, droppedStops } of shifted) {
      assert.ok(Math.abs(finish + droppedStops - fromStart) < 1, `${first} first: finish ${finish} vs ${fromStart}`);
    }

    // The start-line finish is the one the paid projection shows for the same course.
    await pay(app, roomId, runner);
    const paid = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
    assert.ok(Math.abs((Date.parse(paid.etaFinishPlanIso) - Date.parse(raceStartAt)) / 1000 - fromStart) < 1);
  });
});

test("unpaid race: a keyed course save and its replay are the teaser, also for a key first used while paid", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-idem-course";
    const room = await setUpUnpaidRace(app, runner);
    const checkpoints = taggedCourse().checkpoints;
    const shownAid = (response: Awaited<ReturnType<typeof get>>) =>
      (response.json() as RaceRoom).pacingEstimate?.aidEtas.map((eta) => eta.checkpointId);

    for (const attempt of ["first", "replay"]) {
      const response = await resaveCourse(app, room.id, runner, checkpoints, "k-unpaid-1");
      assert.equal(response.statusCode, 200, `${attempt}: ${response.body}`);
      assertNoPaidPlan(response.json(), `unpaid keyed PUT course (${attempt})`, "runner");
      assert.deepEqual(shownAid(response), []);
    }

    // The key is first used while paid, so its stored body is the whole plan.
    await setEntitlement(app, room.id, runner, "paid");
    const paidSave = await resaveCourse(app, room.id, runner, checkpoints, "k-paid-1");
    assert.equal(paidSave.statusCode, 200, paidSave.body);
    assert.deepEqual(shownAid(paidSave), MID_COURSE);
    assert.ok((paidSave.json() as RaceRoom).course?.baselineTrack, "paid saves are unchanged");

    // Refunded: the replay answers from the room as it is now.
    await setEntitlement(app, room.id, runner, "unpaid");
    const replay = await resaveCourse(app, room.id, runner, checkpoints, "k-paid-1");
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal((replay.json() as RaceRoom).entitlement.status, "unpaid");
    assertNoPaidPlan(replay.json(), "refunded keyed PUT course replay", "runner");
    assert.deepEqual(shownAid(replay), []);
  });
});

/** POST /race-rooms with an idempotency key, as a client retry sends it. */
function keyedCreate(app: App, user: string, key: string, name: string) {
  return app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: user, name, creatorRole: "athlete" },
    headers: { ...auth(app, user), "idempotency-key": key }
  });
}

test("unpaid race: a keyed POST /race-rooms retry answers the room as it is now, shaped for the caller", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-idem-create";
    const create = (user: string) => keyedCreate(app, user, "k-create-1", "Keyed 50k");
    const created = await create(runner);
    assert.equal(created.statusCode, 201, created.body);
    const roomId = (created.json() as RaceRoom).id;
    await setUpCourseAndPlan(app, roomId, runner);

    const retry = async (label: string) => {
      const response = await create(runner);
      assert.equal(response.statusCode, 201, `${label}: ${response.body}`);
      const body = response.json() as RaceRoom;
      assert.equal(body.id, roomId);
      assert.deepEqual(body.course?.checkpoints.map((checkpoint) => checkpoint.id), ALL_CHECKPOINTS, `${label}: current room`);
      return body;
    };

    const unpaid = await retry("unpaid retry");
    assertNoPaidPlan(unpaid, "unpaid POST /race-rooms retry", "runner");
    assert.deepEqual(unpaid.pacingEstimate?.aidEtas, []);

    await setEntitlement(app, roomId, runner, "paid");
    const paid = await retry("paid retry");
    assert.deepEqual(paid.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), MID_COURSE);
    assert.ok(paid.course?.baselineTrack, "paid rooms are unchanged");

    await setEntitlement(app, roomId, runner, "unpaid");
    assertNoPaidPlan(await retry("refunded retry"), "refunded POST /race-rooms retry", "runner");

    // Someone else sending the same key and body is not handed the runner's race.
    const stranger = await create("stranger-teaser-idem-create");
    assert.equal(stranger.statusCode, 409, stranger.body);
    assert.equal(Object.hasOwn(stranger.json() as object, "id"), false);
  });
});

test("unpaid race: a keyed POST /race-rooms retry that reclaims the room (no stored replay) is the teaser", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-idem-reclaim";
    const key = "k-create-reclaim-1";
    const created = await keyedCreate(app, runner, key, "Reclaimed 50k");
    assert.equal(created.statusCode, 201, created.body);
    const roomId = (created.json() as RaceRoom).id;
    await setUpCourseAndPlan(app, roomId, runner);

    // The lease and stored response are gone (a lost lease, a failed complete) but the room is
    // saved, so the retry reclaims it: key present, room exists, nothing to replay.
    const reclaim = async (label: string) => {
      await forgetIdempotencyRecordForTests(key, "POST", "/race-rooms");
      const response = await keyedCreate(app, runner, key, "Reclaimed 50k");
      assert.equal(response.statusCode, 201, `${label}: ${response.body}`);
      const body = response.json() as RaceRoom;
      assert.equal(body.id, roomId, `${label}: the same room, not a second one`);
      assert.equal(body.pacingEstimateId, `teaser-estimate-${roomId}`, `${label}: the race has its plan`);
      return response;
    };

    const unpaid = await reclaim("unpaid reclaim");
    assertNoPaidPlan(unpaid.json(), "unpaid POST /race-rooms reclaim", "runner");
    assert.deepEqual((unpaid.json() as RaceRoom).pacingEstimate?.aidEtas, []);
    // The reclaim stored the shaped body, and its replay answers from the room as it is now.
    const replay = await keyedCreate(app, runner, key, "Reclaimed 50k");
    assert.equal(replay.statusCode, 201, replay.body);
    assertNoPaidPlan(replay.json(), "unpaid POST /race-rooms replay after reclaim", "runner");

    await setEntitlement(app, roomId, runner, "paid");
    const paid = (await reclaim("paid reclaim")).json() as RaceRoom;
    assert.deepEqual(paid.pacingEstimate?.aidEtas, MID_COURSE_ETAS);
    assert.ok(paid.course?.baselineTrack, "paid rooms are unchanged");

    await setEntitlement(app, roomId, runner, "unpaid");
    assertNoPaidPlan((await reclaim("refunded reclaim")).json(), "refunded POST /race-rooms reclaim", "runner");
  });
});

test("unpaid race: the runner accepting an invite to their own seat gets 200 and the teaser", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-own-invite";
    const room = await setUpUnpaidRace(app, runner);
    await setEntitlement(app, room.id, runner, "paid");
    const issued = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/invites`,
      payload: { email: "runner-own-seat@example.com", role: "athlete" },
      headers: auth(app, runner)
    });
    assert.equal(issued.statusCode, 201, issued.body);
    await setEntitlement(app, room.id, runner, "unpaid");

    const accept = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/invites/accept`,
      payload: { token: (issued.json() as { token: string }).token },
      headers: auth(app, runner)
    });
    assert.equal(accept.statusCode, 200, accept.body);
    assertNoPaidPlan(accept.json(), "runner invites/accept", "runner");
    const body = accept.json() as { room: RaceRoom; assignedRole: string };
    assert.equal(body.assignedRole, "athlete");
    assert.equal(body.room.entitlement.status, "unpaid");
    assert.deepEqual(body.room.pacingEstimate?.aidEtas, []);
  });
});

/** A race still to come, so the projection's finish is not clamped to now. */
const futureStart = () => new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

/** A new race for `runner` (unpaid), with `checkpoints` on `route` (the full 50k route by default). */
async function raceWithCourse(
  app: App,
  runner: string,
  name: string,
  options: { raceStartAt?: string; checkpoints?: CourseCheckpoints; route?: ReturnType<typeof taggedCourse>["routeOverlayLayer"] } = {}
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: runner, name, creatorRole: "athlete" },
    headers: auth(app, runner)
  });
  assert.equal(created.statusCode, 201, created.body);
  const roomId = (created.json() as RaceRoom).id;
  const saved = await saveCourseOn(app, roomId, runner, options);
  assert.equal(saved.statusCode, 200, saved.body);
  return roomId;
}

/** PUT course with a route overlay: a new course, so the attached plan is dropped. */
function saveCourseOn(
  app: App,
  roomId: string,
  runner: string,
  options: { raceStartAt?: string; checkpoints?: CourseCheckpoints; route?: ReturnType<typeof taggedCourse>["routeOverlayLayer"] } = {}
) {
  const course = taggedCourse();
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: course.plannedPaceSecondsPerKm,
      course: { checkpoints: options.checkpoints ?? course.checkpoints },
      routeOverlayLayer: options.route ?? course.routeOverlayLayer,
      raceStartAt: options.raceStartAt ?? RACE_START_AT
    },
    headers: auth(app, runner)
  });
}

/** The 50k route cut at a checkpoint, and the checkpoints up to it: a shorter course ending there. */
function courseCutAt(checkpointId: string) {
  const course = taggedCourse();
  const at = course.checkpoints.find((checkpoint) => checkpoint.id === checkpointId)!;
  const geometry = course.routeOverlayLayer.geometry;
  assert.equal(geometry.type, "LineString");
  const coordinates = geometry.coordinates as MapWorkspacePosition[];
  const end = coordinates.findIndex(
    ([longitude, latitude]) => Math.abs(latitude - at.latitude) < 1e-6 && Math.abs(longitude - at.longitude) < 1e-6
  );
  assert.ok(end > 0, `the route passes ${checkpointId}`);
  const index = course.checkpoints.indexOf(at);
  return {
    checkpoints: course.checkpoints.slice(0, index + 1),
    route: { ...course.routeOverlayLayer, geometry: { type: "LineString" as const, coordinates: coordinates.slice(0, end + 1) } }
  };
}

const roomOf = async (app: App, roomId: string, user: string) =>
  ((await get(app, `/race-rooms/${roomId}`, user)).json() as { room: RaceRoom }).room;

test("GET /me/export: legacy estimates go out whole while the caller has no unpaid race; new rows keep the rule", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-export-legacy";
    const paid = await setUpUnpaidRace(app, runner, "Paid legacy export");
    await pay(app, paid.id, runner);
    const curve = (await getRaceRoom(paid.id))?.course?.baselineTrack;
    assert.ok(curve, "a stored plan curve, as estimates computed before #724 carried");

    // Stored before #724 (no provenance), by #724 (one room), and from now on (room-less).
    const beforeTeaser = estimateFor("legacy-before-teaser");
    const fromTeaser = estimateFor("legacy-from-724");
    await saveLegacyPacingEstimateForTests(runner, beforeTeaser, { baselineTrack: curve });
    await saveLegacyPacingEstimateForTests(runner, fromTeaser, { roomId: paid.id });
    const roomless = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      payload: { raceStartAt: RACE_START_AT, checkpoints: taggedCourse().checkpoints, seed: "export-legacy-roomless" },
      headers: auth(app, runner)
    });
    assert.equal(roomless.statusCode, 200, roomless.body);
    const roomlessId = (roomless.json() as PacingEstimate).id;
    assert.equal((await getPacingEstimateById(roomlessId))?.legacyProvenance, false, "rows written now are not legacy");

    const exported = async (label: string) => {
      const response = await get(app, "/me/export", runner);
      assert.equal(response.statusCode, 200, `${label}: ${response.body}`);
      const estimates = (response.json() as { pacingEstimates: PacingEstimate[] }).pacingEstimates;
      const byId = (id: string) => {
        const found = estimates.find((estimate) => estimate.id === id);
        assert.ok(found, `${label}: export lists ${id}`);
        return found;
      };
      return { byId, priced: (id: string) => byId(id).aidEtas.map((eta) => eta.checkpointId) };
    };

    // A paying runner with no unpaid race gets every legacy estimate whole, as before #724.
    const paying = await exported("paid races only");
    assert.deepEqual(paying.priced(beforeTeaser.id), MID_COURSE, "stored before #724");
    assert.deepEqual(paying.priced(fromTeaser.id), MID_COURSE, "stored by #724 for the paid race");
    assert.deepEqual(paying.priced(roomlessId), [], "a row written now keeps the rule: room-less is finish-only");
    assertNoPaidPlan(paying.byId(roomlessId), "room-less row written now", "runner");

    // Once the runner has an unpaid race, a legacy estimate could be its plan: the rule applies.
    await setUpUnpaidRace(app, runner, "Unpaid legacy export");
    const withUnpaid = await exported("with an unpaid race");
    assert.deepEqual(withUnpaid.priced(beforeTeaser.id), [], "no race ties it");
    assertNoPaidPlan(withUnpaid.byId(beforeTeaser.id), "legacy row with an unpaid race", "runner");
    assert.deepEqual(withUnpaid.priced(fromTeaser.id), MID_COURSE, "its recorded race is paid");
    assert.deepEqual(withUnpaid.priced(`teaser-estimate-${paid.id}`), MID_COURSE, "the paid race's plan");
    assertNoPaidPlan(withUnpaid.byId(roomlessId), "room-less row with an unpaid race", "runner");
  });
});

test("one estimate id computed for an unpaid and a paid race: both stay recorded and the paid race attaches it", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-shared-id";
    const paid = await setUpUnpaidRace(app, runner, "Paid shared 50k");
    await pay(app, paid.id, runner);
    const unpaid = await setUpUnpaidRace(app, runner, "Unpaid shared 50k");

    // Same course and start, so the same inputs and the same estimate id.
    const forPaid = await computeForRoom(app, paid.id, runner);
    assert.equal(forPaid.statusCode, 200, forPaid.body);
    const forUnpaid = await computeForRoom(app, unpaid.id, runner);
    assert.equal(forUnpaid.statusCode, 200, forUnpaid.body);
    assertNoPaidPlan(forUnpaid.json(), "runner POST /pacing-estimates (unpaid)", "runner");
    const id = (forPaid.json() as PacingEstimate).id;
    assert.equal((forUnpaid.json() as PacingEstimate).id, id, "one id for both races");
    const both = [paid.id, unpaid.id].sort();
    assert.deepEqual((await getPacingEstimateById(id))?.roomIds, both, "computing for the unpaid race kept the paid one");

    // The paid race attaches it whole; computing for the unpaid race did not take it away.
    const attached = await attachById(app, paid.id, runner, id);
    assert.equal(attached.statusCode, 200, attached.body);
    assert.deepEqual(
      (attached.json() as { estimate: PacingEstimate }).estimate.aidEtas.map((eta) => eta.checkpointId),
      MID_COURSE
    );
    assert.deepEqual((await getPacingEstimateById(id))?.roomIds, both);

    // An idempotent re-attach changes nothing, on either race.
    const again = await attachById(app, paid.id, runner, id);
    assert.equal(again.statusCode, 200, again.body);
    assert.deepEqual((await getPacingEstimateById(id))?.roomIds, both, "idempotent re-attach: set unchanged");
    const onUnpaid = await attachById(app, unpaid.id, runner, id);
    assert.equal(onUnpaid.statusCode, 200, onUnpaid.body);
    assertNoPaidPlan(onUnpaid.json(), "runner PUT pacing-estimate (unpaid, shared id)", "runner");
    const unpaidAgain = await attachById(app, unpaid.id, runner, id);
    assert.equal(unpaidAgain.statusCode, 200, unpaidAgain.body);
    assertNoPaidPlan(unpaidAgain.json(), "runner PUT pacing-estimate (unpaid, idempotent)", "runner");
    assert.deepEqual((await getPacingEstimateById(id))?.roomIds, both, "idempotent re-attach on the unpaid race: set unchanged");
    assert.deepEqual(await readTeaser(app, unpaid.id, runner, "unpaid race, shared id"), {
      aidEtas: [],
      splits: [],
      stops: ["start", "finish"],
      locked: MID_COURSE
    });

    // The paid race in the set already shows it whole, so another paid race of the runner's takes it too.
    const other = await setUpUnpaidRace(app, runner, "Other paid 50k");
    await pay(app, other.id, runner);
    assert.equal((await attachById(app, other.id, runner, id)).statusCode, 200);
    assert.deepEqual((await getPacingEstimateById(id))?.roomIds, [...both, other.id].sort());
  });
});

test("an estimate that is already a race's plan of record re-attaches there, whatever race it last recorded", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-plan-of-record";
    const paid = await setUpUnpaidRace(app, runner, "Paid plan of record");
    await pay(app, paid.id, runner);
    const unpaid = await setUpUnpaidRace(app, runner, "Unpaid plan of record");
    const id = `teaser-estimate-${paid.id}`;
    const stored = await getPacingEstimateById(id);
    assert.ok(stored);

    // As #724 left it when the same id was then computed for the unpaid race: one room, the unpaid one.
    await saveLegacyPacingEstimateForTests(runner, stored.estimate, { roomId: unpaid.id });
    const again = await attachById(app, paid.id, runner, id);
    assert.equal(again.statusCode, 200, again.body);
    assert.deepEqual((again.json() as { estimate: PacingEstimate }).estimate.aidEtas, MID_COURSE_ETAS);
    // The re-attach writes the row in the current format and keeps the unpaid race in its set.
    assert.deepEqual((await getPacingEstimateById(id))?.roomIds, [paid.id, unpaid.id].sort());
    assert.equal((await getPacingEstimateById(id))?.legacyProvenance, false);
    // Another paid race of the runner's takes it: the set now names a paid race of theirs, which
    // already shows it whole.
    const other = await setUpUnpaidRace(app, runner, "Other plan of record");
    await pay(app, other.id, runner);
    assert.equal((await attachById(app, other.id, runner, id)).statusCode, 200);
  });
});

/** Keys that carry a time: every ETA key, and the finish and band fields of estimates and projections. */
const TIME_KEYS = new Set([
  ...ETA_KEYS,
  "expectedFinishAt",
  "expectedFinishElapsedSeconds",
  "finishAt",
  "finishElapsedSeconds",
  "etaFinishPlanIso",
  "earliestIso",
  "latestIso"
]);

/** Fails if any time anywhere in `body` (an ETA, a finish, a band, a window) is one of `values`. */
function assertNoTimeIn(body: unknown, values: ReadonlySet<unknown>, label: string): void {
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (TIME_KEYS.has(key)) assert.equal(values.has(child), false, `${label}: ${path}.${key} is a real aid ETA (${String(child)})`);
      walk(child, `${path}.${key}`);
    }
  };
  walk(body, "$");
}

/** Rounding to whole seconds on the schedule's side. */
function withinASecond(a: number, b: number, what: string): void {
  assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} vs ${b}`);
}

const sinceStart = (iso: string, raceStartAt: string) => (Date.parse(iso) - Date.parse(raceStartAt)) / 1000;

/** The finish each of the runner's reads of a race shows, in seconds from the start. */
type ReadFinishes = {
  /** The schedule's rows, in order. */
  stops: string[];
  /**
   * The schedule's last row: its arrival (a row's own planned stop never shifts it, but a row
   * standing in for the finish past it on a course with no finish waypoint arrives after it).
   */
  schedule: number;
  /** The schedule's last row, moving time only (the attached plan's finish, when there is one). */
  scheduleMoving: number | undefined;
  /** The projection's finish (moving time plus every planned stop before the finish). */
  projection: number;
  /** The attached plan's finish, as GET room shows it (moving time). */
  room: number | undefined;
  /**
   * Every checkpoint's planned stop but the finish checkpoint's own (`finishCheckpointIndex`: the
   * arrival there is the finish). With no finish checkpoint (no finish waypoint), every one.
   */
  plannedStops: number;
};

/**
 * The runner's reads of a race (room, projection, schedule) and the finish each shows. Unless
 * `teaser` is false, each read is checked for the plan (`assertNoPaidPlan`) and for `realValues`.
 */
async function teaserFinishes(
  app: App,
  roomId: string,
  runner: string,
  raceStartAt: string,
  label: string,
  midCourse?: ReadonlySet<string>,
  realValues?: ReadonlySet<unknown>,
  teaser = true
): Promise<ReadFinishes> {
  const reads = {
    room: await get(app, `/race-rooms/${roomId}`, runner),
    projection: await get(app, `/race-rooms/${roomId}/projection`, runner),
    schedule: await get(app, `/race-rooms/${roomId}/schedule`, runner)
  };
  for (const [name, response] of Object.entries(reads)) {
    assert.equal(response.statusCode, 200, `${label}: GET ${name}: ${response.body}`);
    if (!teaser) continue;
    assertNoPaidPlan(response.json(), `${label}: GET ${name}`, "runner", midCourse);
    if (realValues) assertNoTimeIn(response.json(), realValues, `${label}: GET ${name}`);
  }
  const schedule = parseCrewScheduleSheet(reads.schedule.json());
  const last = schedule.stops[schedule.stops.length - 1]!;
  const room = (reads.room.json() as { room: RaceRoom }).room;
  const projection = reads.projection.json() as RaceRoomProjection;
  const checkpoints = room.course?.checkpoints ?? [];
  const finishIndex = finishCheckpointIndex(checkpoints, projection.courseLengthMeters);
  return {
    stops: schedule.stops.map((stop) => stop.checkpointId),
    schedule: sinceStart(last.clockArrivalAt, raceStartAt),
    scheduleMoving: last.movingElapsedSeconds,
    projection: sinceStart(projection.etaFinishPlanIso, raceStartAt),
    room: room.pacingEstimate?.expectedFinishElapsedSeconds,
    plannedStops: checkpoints
      .filter((_checkpoint, index) => index !== finishIndex)
      .reduce((sum, checkpoint) => sum + (checkpoint.plannedStopSeconds ?? 0), 0)
  };
}

/**
 * The schedule's finish row, the projection's finish and GET room's are one finish. With a plan
 * attached (`planFinish`, moving time) it is that plan's finish on every read.
 */
function assertOneFinish(finishes: ReadFinishes, label: string, planFinish?: number): void {
  withinASecond(finishes.schedule, finishes.projection, `${label}: schedule finish vs projection finish`);
  if (planFinish === undefined) {
    assert.equal(finishes.room, undefined, `${label}: no plan attached`);
    return;
  }
  assert.equal(finishes.room, planFinish, `${label}: GET room finish`);
  assert.equal(finishes.scheduleMoving, planFinish, `${label}: schedule finish row`);
  withinASecond(planFinish + finishes.plannedStops, finishes.projection, `${label}: room finish vs projection finish`);
}

/** A position on the 50k route `metersBeforeEnd` before its end (on its last leg, a straight line). */
function pointBeforeEnd(metersBeforeEnd: number): { latitude: number; longitude: number } {
  const geometry = taggedCourse().routeOverlayLayer.geometry;
  assert.equal(geometry.type, "LineString");
  const coordinates = geometry.coordinates as MapWorkspacePosition[];
  const [lonA, latA] = coordinates[coordinates.length - 2]!;
  const [lonB, latB] = coordinates[coordinates.length - 1]!;
  const leg = geodesicDistanceMeters({ latitude: latA, longitude: lonA }, { latitude: latB, longitude: lonB });
  assert.ok(metersBeforeEnd < leg, `the last leg is ${leg} m`);
  const t = 1 - metersBeforeEnd / leg;
  return { latitude: latA + t * (latB - latA), longitude: lonA + t * (lonB - lonA) };
}

/** An aid station `metersBeforeEnd` before the end of the 50k route, with the finish's planned stop. */
function nearEndAid(metersBeforeEnd: number, id: string): CourseCheckpoints[number] {
  const finish = taggedCourse().checkpoints.find((checkpoint) => checkpoint.id === "finish")!;
  return {
    ...finish,
    id,
    title: `Aid ${metersBeforeEnd} m before the end`,
    tags: ["aid"],
    ...pointBeforeEnd(metersBeforeEnd),
    distanceMetersFromStart: finish.distanceMetersFromStart! - metersBeforeEnd
  };
}

/** Every aid ETA of a stored (whole) estimate: the plan's real ones, which no unpaid read may show. */
async function realAidEtas(estimateId: string): Promise<{ etas: PacingEstimate["aidEtas"]; values: Set<unknown> }> {
  const stored = await getPacingEstimateById(estimateId);
  assert.ok(stored, `${estimateId} is stored`);
  const etas = stored.estimate.aidEtas;
  return { etas, values: new Set<unknown>(etas.flatMap((eta) => [eta.elapsedSeconds, eta.clockArrivalAt])) };
}

/** A new race for `runner` on the 50k route, paid, and the plan computed for it (whole). */
async function paidRacePlan(app: App, runner: string, name: string, raceStartAt: string, checkpoints: CourseCheckpoints) {
  const roomId = await raceWithCourse(app, runner, name, { raceStartAt, checkpoints });
  await pay(app, roomId, runner);
  const computed = await computeForRoom(app, roomId, runner);
  assert.equal(computed.statusCode, 200, `${name}: ${computed.body}`);
  return computed.json() as PacingEstimate;
}

test("unpaid race: schedule, projection, room and export show one finish at the course end, with and without a plan", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-finish";
    const raceStartAt = futureStart();
    const fixture = taggedCourse().checkpoints;
    const aid = nearEndAid(450, "aid-near-end-450");
    const courses = [
      { course: "finish at the route's end", checkpoints: fixture, last: "finish" },
      // Within 1% of the end: the farthest checkpoint is not the course end.
      { course: "aid 450 m before the end, finish dropped", checkpoints: [...fixture.filter((checkpoint) => checkpoint.id !== "finish"), aid], last: aid.id }
    ];

    for (const { course, checkpoints, last } of courses) {
      for (const withPlan of [false, true]) {
        const label = `${course}, ${withPlan ? "plan attached" : "no plan"}`;
        const roomId = await raceWithCourse(app, runner, label, { raceStartAt, checkpoints });
        let plan: PacingEstimate | undefined;
        if (withPlan) {
          const computed = await computeForRoom(app, roomId, runner);
          assert.equal(computed.statusCode, 200, `${label}: ${computed.body}`);
          plan = computed.json() as PacingEstimate;
          const attach = await attachById(app, roomId, runner, plan.id);
          assert.equal(attach.statusCode, 200, `${label}: ${attach.body}`);
          assert.equal((attach.json() as { estimate: PacingEstimate }).estimate.expectedFinishElapsedSeconds, plan.expectedFinishElapsedSeconds);
        } else {
          assert.ok((await getRaceRoom(roomId))?.course?.baselineTrack, `${label}: the course has a plan curve and no estimate`);
          assert.equal((await getRaceRoom(roomId))?.pacingEstimateId, undefined);
        }
        const unpaid = await teaserFinishes(app, roomId, runner, raceStartAt, label, new Set(MID_COURSE));
        assert.deepEqual(unpaid.stops, ["start", last]);
        assertOneFinish(unpaid, label, plan?.expectedFinishElapsedSeconds);
        if (plan) {
          const exported = (await get(app, "/me/export", runner)).json() as { pacingEstimates: PacingEstimate[] };
          const listed = exported.pacingEstimates.find((estimate) => estimate.id === plan.id);
          assert.equal(listed?.expectedFinishElapsedSeconds, plan.expectedFinishElapsedSeconds, `${label}: GET /me/export finish`);
          assert.deepEqual(listed?.aidEtas, [], `${label}: GET /me/export is finish-only`);
        }

        // Paying shows the same finish on the projection (it reads the course end either way) and,
        // on a course that ends at its finish, on the schedule.
        await pay(app, roomId, runner);
        const paid = await teaserFinishes(app, roomId, runner, raceStartAt, `${label}, paid`, undefined, undefined, false);
        withinASecond(unpaid.projection, paid.projection, `${label}: unpaid vs paid projection`);
        if (last === "finish" || plan) {
          withinASecond(unpaid.schedule, paid.schedule, `${label}: unpaid vs paid schedule`);
        }
      }
    }
  });
});

test("unpaid race: a stored plan re-attached to a shortened course is 400 course_mismatch; paid races are unchanged", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-shortened";
    const raceStartAt = futureStart();
    const cut = courseCutAt("aid-1");

    for (const status of ["unpaid", "paid"] as const) {
      const roomId = await raceWithCourse(app, runner, `Shortened ${status}`, { raceStartAt });
      if (status === "paid") await pay(app, roomId, runner);
      // Compute once on the full course and attach it.
      const computed = await computeForRoom(app, roomId, runner);
      assert.equal(computed.statusCode, 200, computed.body);
      const planId = (computed.json() as PacingEstimate).id;
      assert.equal((await attachById(app, roomId, runner, planId)).statusCode, 200);
      const stored = await getPacingEstimateById(planId);
      const aid1 = stored?.estimate.aidEtas.find((eta) => eta.checkpointId === "aid-1");
      assert.ok(aid1, "the whole plan prices aid-1");

      // The route cut at aid-1, checkpoints [start, aid-1]: a new course, the plan is dropped.
      const saved = await saveCourseOn(app, roomId, runner, { raceStartAt, ...cut });
      assert.equal(saved.statusCode, 200, saved.body);
      assert.ok(Math.abs((lengthOf((await getRaceRoom(roomId))!) ?? 0) - aid1Distance()) < 100);
      const reattach = await attachById(app, roomId, runner, planId);

      if (status === "unpaid") {
        assert.equal(reattach.statusCode, 400, reattach.body);
        assert.equal((reattach.json() as { code: string }).code, "course_mismatch");
        assert.equal((await roomOf(app, roomId, runner)).pacingEstimateId, undefined, "nothing attached");
        assert.deepEqual((await getPacingEstimateById(planId))?.roomIds, [roomId], "provenance unchanged");
        // The teaser reads show the start and the new finish, and no ETA of the old plan.
        assert.deepEqual(await readTeaser(app, roomId, runner, "shortened, refused", new Set()), {
          aidEtas: undefined,
          splits: [],
          stops: ["start", "aid-1"],
          locked: []
        });
        const projection = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
        const finishElapsed = (Date.parse(projection.etaFinishPlanIso) - Date.parse(raceStartAt)) / 1000;
        // aid-1 is the finish now, so only the start's planned stop counts toward it.
        assert.ok(Math.abs(finishElapsed - (aid1.elapsedSeconds + 120)) > 60, `the finish is not aid-1's split: ${finishElapsed}`);

        // A recompute for the shortened course attaches, finish-only.
        const recomputed = await computeForRoom(app, roomId, runner);
        assert.equal(recomputed.statusCode, 200, recomputed.body);
        assertNoPaidPlan(recomputed.json(), "recompute on the shortened course", "runner", new Set());
        const fresh = await attachById(app, roomId, runner, (recomputed.json() as PacingEstimate).id);
        assert.equal(fresh.statusCode, 200, fresh.body);
        assertNoPaidPlan(fresh.json(), "attach the recompute on the shortened course", "runner", new Set());
      } else {
        // Paid: unchanged, and the finish then reads the old plan's curve at aid-1.
        assert.equal(reattach.statusCode, 200, reattach.body);
        assert.equal((await roomOf(app, roomId, runner)).pacingEstimateId, planId);
        const projection = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
        const finishElapsed = (Date.parse(projection.etaFinishPlanIso) - Date.parse(raceStartAt)) / 1000;
        // aid-1's full-race ETA plus the planned stop at the start: aid-1 is the finish now, and
        // the finish is the arrival there, without its own stop.
        assert.ok(Math.abs(finishElapsed - (aid1.elapsedSeconds + 120)) <= 2, `paid finish ${finishElapsed} vs aid-1 ${aid1.elapsedSeconds}`);
      }
    }
  });
});

function aid1Distance(): number {
  return taggedCourse().checkpoints.find((checkpoint) => checkpoint.id === "aid-1")!.distanceMetersFromStart!;
}

test("unpaid race: course saves are capped at 10 an hour per user; paid course saves are not", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-course-limit";
    const first = await setUpUnpaidRace(app, runner, "Limit A");
    const second = await setUpUnpaidRace(app, runner, "Limit B");
    const checkpoints = taggedCourse().checkpoints;

    // Two saves used setting up; both races share the runner's budget.
    for (let i = 0; i < 8; i += 1) {
      const saved = await resaveCourse(app, i % 2 === 0 ? first.id : second.id, runner, checkpoints);
      assert.equal(saved.statusCode, 200, `save ${i + 3}: ${saved.body}`);
      assertNoPaidPlan(saved.json(), `unpaid course save ${i + 3}`, "runner");
    }
    for (const roomId of [first.id, second.id]) {
      const limited = await resaveCourse(app, roomId, runner, checkpoints);
      assert.equal(limited.statusCode, 429, limited.body);
      assert.deepEqual(limited.json(), { error: "Too many requests" });
      // About an hour, not a minute.
      assert.ok(Number(limited.headers["retry-after"]) > 60 * 59);
    }

    // Another runner has their own budget.
    const other = await setUpUnpaidRace(app, "runner-teaser-course-limit-other", "Limit other");
    assert.equal((await resaveCourse(app, other.id, "runner-teaser-course-limit-other", checkpoints)).statusCode, 200);

    // Paid: unlimited, as before. The unpaid race stays capped.
    await pay(app, first.id, runner);
    for (let i = 0; i < 12; i += 1) {
      assert.equal((await resaveCourse(app, first.id, runner, checkpoints)).statusCode, 200, `paid save ${i + 1}`);
    }
    assert.equal((await resaveCourse(app, second.id, runner, checkpoints)).statusCode, 429);
  });
});

test("unpaid race: an aid 300 m or 450 m before the end, the finish dropped: no read shows its ETA, and the finish is the course end's", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-near-end";
    const raceStartAt = futureStart();
    const fixture = taggedCourse().checkpoints;
    const beforeFinish = fixture.filter((checkpoint) => checkpoint.id !== "finish");
    const finish = fixture.find((checkpoint) => checkpoint.id === "finish")!;
    const midCourse = new Set(MID_COURSE);

    for (const metersBeforeEnd of [300, 450]) {
      const label = `aid ${metersBeforeEnd} m before the end`;
      // Its own id per distance, so the two plans never share an estimate id.
      const aid = nearEndAid(metersBeforeEnd, `aid-near-end-${metersBeforeEnd}`);
      const roomId = await raceWithCourse(app, runner, `Unpaid, ${label}`, { raceStartAt, checkpoints: [...beforeFinish, aid] });
      // Within 1% of the course of its end: where the farthest-checkpoint check let it through.
      const saved = (await getRaceRoom(roomId))!;
      const aidMeters = saved.course!.checkpoints.find((checkpoint) => checkpoint.id === aid.id)!.distanceMetersFromStart!;
      assert.ok(Math.abs(lengthOf(saved)! - aidMeters - metersBeforeEnd) < 5, `${label}: at ${aidMeters} m`);
      assert.equal(courseLengthsMatch(aidMeters, lengthOf(saved)), true, `${label}: inside the old tolerance`);

      const computed = await computeForRoom(app, roomId, runner);
      assert.equal(computed.statusCode, 200, `${label}: ${computed.body}`);
      const plan = computed.json() as PacingEstimate;
      // The plan as stored (whole): its real aid ETAs, the near-end aid's among them.
      const real = await realAidEtas(plan.id);
      const aidEta = real.etas.find((eta) => eta.checkpointId === aid.id);
      assert.ok(aidEta && aidEta.elapsedSeconds < plan.expectedFinishElapsedSeconds - 60, `${label}: the aid is priced before the finish`);
      assertNoPaidPlan(computed.json(), `${label}: POST /pacing-estimates`, "runner", midCourse);
      assertNoTimeIn(computed.json(), real.values, `${label}: POST /pacing-estimates`);

      // Attach, then again (the idempotent re-attach): finish-only, the same finish.
      for (const attempt of ["attach", "re-attach"]) {
        const attach = await attachById(app, roomId, runner, plan.id);
        assert.equal(attach.statusCode, 200, `${label}: ${attempt}: ${attach.body}`);
        assertNoPaidPlan(attach.json(), `${label}: ${attempt}`, "runner", midCourse);
        assertNoTimeIn(attach.json(), real.values, `${label}: ${attempt}`);
      }
      const finishes = await teaserFinishes(app, roomId, runner, raceStartAt, label, midCourse, real.values);
      assert.deepEqual(finishes.stops, ["start", aid.id]);
      assertOneFinish(finishes, label, plan.expectedFinishElapsedSeconds);

      // The export, before any paid race shares this estimate id: finish-only, the same finish.
      const exported = await get(app, "/me/export", runner);
      assert.equal(exported.statusCode, 200, exported.body);
      const listed = (exported.json() as { pacingEstimates: PacingEstimate[] }).pacingEstimates.find((estimate) => estimate.id === plan.id);
      assert.ok(listed, `${label}: the export lists the plan`);
      assert.equal(listed.expectedFinishElapsedSeconds, plan.expectedFinishElapsedSeconds);
      assertNoTimeIn(listed, real.values, `${label}: GET /me/export`);

      // The paid twin keeps the finish: the same aid ETA, and the course-end finish the unpaid plan has.
      const twin = await paidRacePlan(app, runner, `Twin, ${label}`, raceStartAt, [...beforeFinish, aid, finish]);
      assert.equal(twin.aidEtas.find((eta) => eta.checkpointId === aid.id)?.elapsedSeconds, aidEta.elapsedSeconds, `${label}: the twin prices the aid the same`);
      assert.equal(plan.expectedFinishElapsedSeconds, twin.expectedFinishElapsedSeconds, `${label}: the paid twin's finish`);
      assert.deepEqual(plan.bands, twin.bands, `${label}: the paid twin's bands`);
      // A paid race reads its finish at the route's end too: with the finish dropped, its finish is
      // the twin's, never the aid's ETA.
      const paidCut = await paidRacePlan(app, runner, `Paid, finish dropped, ${label}`, raceStartAt, [...beforeFinish, aid]);
      assert.equal(paidCut.expectedFinishElapsedSeconds, twin.expectedFinishElapsedSeconds, `${label}: a paid race's finish is the route end's`);
      assert.ok(paidCut.expectedFinishElapsedSeconds > aidEta.elapsedSeconds + 60, `${label}: a paid race's finish is not the aid's ETA`);
      assert.equal(paidCut.aidEtas.find((eta) => eta.checkpointId === aid.id)?.elapsedSeconds, aidEta.elapsedSeconds, `${label}: the aid keeps its own ETA`);

      // The unpaid race is still the teaser once a paid race shares its plan.
      assertOneFinish(await teaserFinishes(app, roomId, runner, raceStartAt, `${label}, after the twin`, midCourse, real.values), label, twin.expectedFinishElapsedSeconds);
    }
  });
});

test("unpaid race: checkpoints that end at an aid more than 1% short of the route compute and attach; the finish is the course end's, and no read shows a real aid ETA", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-cut-checkpoints";
    const raceStartAt = futureStart();
    const checkpoints = taggedCourse().checkpoints;

    // The paid twin: the same route and start with its finish, so the model's real aid ETAs for this
    // race and its course-end finish.
    const twin = await paidRacePlan(app, runner, "Paid twin", raceStartAt, checkpoints);
    assert.deepEqual(twin.aidEtas.map((eta) => eta.checkpointId), MID_COURSE);
    const realValues = new Set<unknown>(twin.aidEtas.flatMap((eta) => [eta.elapsedSeconds, eta.clockArrivalAt]));
    const cutAt = (stop: string) => checkpoints.slice(0, checkpoints.findIndex((checkpoint) => checkpoint.id === stop) + 1);
    const midCourseTo = (stop: string) =>
      new Set(cutAt(stop).map((checkpoint) => checkpoint.id).filter((id) => id !== "start" && id !== stop));
    const computeAndAttach = async (roomId: string, label: string, midCourse: ReadonlySet<string>) => {
      const computed = await computeForRoom(app, roomId, runner);
      assert.equal(computed.statusCode, 200, `${label}: ${computed.body}`);
      assertNoPaidPlan(computed.json(), `${label}: POST /pacing-estimates`, "runner", midCourse);
      assertNoTimeIn(computed.json(), realValues, `${label}: POST /pacing-estimates`);
      const plan = computed.json() as PacingEstimate;
      assert.equal(plan.expectedFinishElapsedSeconds, twin.expectedFinishElapsedSeconds, `${label}: the course-end finish`);
      assert.deepEqual(plan.bands, twin.bands, `${label}: bands`);
      const attach = await attachById(app, roomId, runner, plan.id);
      assert.equal(attach.statusCode, 200, `${label}: ${attach.body}`);
      assertNoPaidPlan(attach.json(), `${label}: PUT pacing-estimate`, "runner", midCourse);
      assertNoTimeIn(attach.json(), realValues, `${label}: PUT pacing-estimate`);
      return plan;
    };

    // A GPX with no finish waypoint: its route runs to the end, its waypoints stop at an aid.
    for (const stop of MID_COURSE) {
      const label = `no finish waypoint, last ${stop}`;
      const midCourse = midCourseTo(stop);
      const roomId = await raceWithCourse(app, runner, label, { raceStartAt, checkpoints: cutAt(stop) });
      const room = (await getRaceRoom(roomId))!;
      const stopMeters = room.course!.checkpoints.at(-1)!.distanceMetersFromStart!;
      assert.equal(courseLengthsMatch(stopMeters, lengthOf(room)), false, `${label}: more than 1% short`);

      const before = await teaserFinishes(app, roomId, runner, raceStartAt, `${label}, no plan`, midCourse, realValues);
      assert.deepEqual(before.stops, ["start", stop]);
      assertOneFinish(before, `${label}, no plan`);
      const plan = await computeAndAttach(roomId, label, midCourse);
      const after = await teaserFinishes(app, roomId, runner, raceStartAt, `${label}, plan`, midCourse, realValues);
      assert.deepEqual(after.stops, ["start", stop]);
      assertOneFinish(after, `${label}, plan`, plan.expectedFinishElapsedSeconds);
      // Done with it: deleted so the runner stays under the unpaid race limit for the next one.
      assert.equal(await deleteRaceRoomAndData(roomId), "deleted");
    }

    // A plan attached on the whole course, then the checkpoints cut at each aid in turn with the
    // route kept: the plan stays and re-attaches, and a recompute has the same course-end finish.
    const roomId = await raceWithCourse(app, runner, "Cut after a plan", { raceStartAt });
    let attached = await computeAndAttach(roomId, "whole course", new Set(MID_COURSE));
    for (const stop of MID_COURSE) {
      const label = `checkpoints cut to ${stop}, route kept`;
      const midCourse = midCourseTo(stop);
      const saved = await resaveCourse(app, roomId, runner, cutAt(stop), undefined, raceStartAt);
      assert.equal(saved.statusCode, 200, `${label}: ${saved.body}`);
      assertNoPaidPlan(saved.json(), `${label}: PUT course`, "runner", midCourse);
      assertNoTimeIn(saved.json(), realValues, `${label}: PUT course`);
      assert.equal((await getRaceRoom(roomId))?.pacingEstimateId, attached.id, `${label}: the plan stays`);
      // GET room and the schedule's finish row are the attached plan's finish. The projection is
      // left out here: a save with no plan curve in it puts the route model's curve on the course
      // (paid races too) and the projection reads that curve, until the next attach.
      const resaved = await teaserFinishes(app, roomId, runner, raceStartAt, label, midCourse, realValues);
      assert.deepEqual(resaved.stops, ["start", stop]);
      assert.equal(resaved.room, attached.expectedFinishElapsedSeconds, `${label}: GET room finish`);
      assert.equal(resaved.scheduleMoving, attached.expectedFinishElapsedSeconds, `${label}: schedule finish row`);
      const again = await attachById(app, roomId, runner, attached.id);
      assert.equal(again.statusCode, 200, `${label}: re-attach: ${again.body}`);
      assertNoTimeIn(again.json(), realValues, `${label}: re-attach`);
      attached = await computeAndAttach(roomId, `${label}, recomputed`, midCourse);
      assertOneFinish(
        await teaserFinishes(app, roomId, runner, raceStartAt, `${label}, recomputed`, midCourse, realValues),
        `${label}, recomputed`,
        attached.expectedFinishElapsedSeconds
      );
    }

    // No estimate the runner holds, but those tied to the paid twin, carries a real aid ETA.
    const exported = await get(app, "/me/export", runner);
    assert.equal(exported.statusCode, 200, exported.body);
    for (const estimate of (exported.json() as { pacingEstimates: PacingEstimate[] }).pacingEstimates) {
      if (estimate.id === twin.id) continue;
      assertNoTimeIn(estimate, realValues, `GET /me/export ${estimate.id}`);
    }
  });
});

/** Strips the stored course length (canonical and room distance), as on a room saved before they were stored. */
async function asLegacyRoom(roomId: string): Promise<RaceRoom> {
  const updated = await commitRaceRoomUpdate(roomId, (latest) => {
    const { courseDistanceMeters: _distance, ...room } = latest;
    const { derivedMetrics: _metrics, ...course } = latest.course!;
    return { ...room, course };
  });
  assert.ok(updated);
  assert.equal(updated.course?.derivedMetrics, undefined);
  assert.equal(updated.courseDistanceMeters, undefined);
  // The projection rebuilt on the legacy room, as after a restart.
  await refreshProjectionAfterPlanOfRecordChange(roomId, updated);
  return updated;
}

test("unpaid legacy race with no stored course length: the finish is the route's end; with no route an attach is course_mismatch", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-legacy-length";
    const raceStartAt = futureStart();
    const fixture = taggedCourse().checkpoints;
    const twin = await paidRacePlan(app, runner, "Paid twin", raceStartAt, fixture);
    const realValues = new Set<unknown>(twin.aidEtas.flatMap((eta) => [eta.elapsedSeconds, eta.clockArrivalAt]));
    const variants = [
      { label: "legacy, full course", checkpoints: fixture },
      // Before, the course length fell back to aid-3, the farthest checkpoint, and its finish there.
      { label: "legacy, finish dropped", checkpoints: fixture.filter((checkpoint) => checkpoint.id !== "finish") }
    ];
    let legacyRoomId = "";
    let legacyPlanId = "";
    for (const { label, checkpoints } of variants) {
      const last = checkpoints[checkpoints.length - 1]!.id;
      const midCourse = new Set(MID_COURSE.filter((id) => id !== last));
      const roomId = await raceWithCourse(app, runner, label, { raceStartAt, checkpoints });
      const legacy = await asLegacyRoom(roomId);
      const route = resolveRouteMetricPointsFromRaceRoomExport(legacy);
      assert.ok(route, `${label}: the route stays`);
      const routeMeters = geodesicPolylineLength(route);
      assert.equal(courseLengthOf(legacy, route), routeMeters, `${label}: the route's length`);
      assert.equal(courseLengthOf(legacy, null), undefined, `${label}: never the farthest checkpoint's`);

      const computed = await computeForRoom(app, roomId, runner);
      assert.equal(computed.statusCode, 200, `${label}: ${computed.body}`);
      assertNoPaidPlan(computed.json(), `${label}: POST /pacing-estimates`, "runner", midCourse);
      assertNoTimeIn(computed.json(), realValues, `${label}: POST /pacing-estimates`);
      const plan = computed.json() as PacingEstimate;
      assert.equal(plan.expectedFinishElapsedSeconds, twin.expectedFinishElapsedSeconds, `${label}: the course-end finish`);
      assert.ok(Math.abs((await getPacingEstimateById(plan.id))!.courseLengthMeters! - routeMeters) < 1, `${label}: recorded for the route`);
      const attach = await attachById(app, roomId, runner, plan.id);
      assert.equal(attach.statusCode, 200, `${label}: ${attach.body}`);
      assertNoTimeIn(attach.json(), realValues, `${label}: PUT pacing-estimate`);

      const finishes = await teaserFinishes(app, roomId, runner, raceStartAt, label, midCourse, realValues);
      assert.deepEqual(finishes.stops, ["start", last]);
      assertOneFinish(finishes, label, plan.expectedFinishElapsedSeconds);
      const projection = (await get(app, `/race-rooms/${roomId}/projection`, runner)).json() as RaceRoomProjection;
      assert.ok(Math.abs(projection.courseLengthMeters - routeMeters) < 1, `${label}: the projection reads the route's length`);
      legacyRoomId = roomId;
      legacyPlanId = plan.id;
    }

    // No stored length and no route: no length to match, so even the plan already attached is refused.
    const noRoute = await commitRaceRoomUpdate(legacyRoomId, (latest) => {
      const { mapWorkspace: _route, ...room } = latest;
      return room;
    });
    assert.ok(noRoute);
    assert.equal(resolveRouteMetricPointsFromRaceRoomExport(noRoute), null);
    assert.equal(courseLengthOf(noRoute, null), undefined);
    const refused = await attachById(app, legacyRoomId, runner, legacyPlanId);
    assert.equal(refused.statusCode, 400, refused.body);
    assert.equal((refused.json() as { code: string }).code, "course_mismatch");
  });
});

test("unpaid race: only a course save that writes counts toward the limit; replays and rejected saves do not", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-course-limit-writes";
    const created = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: { teamId: "team-1", athleteId: runner, name: "Limit writes", creatorRole: "athlete" },
      headers: auth(app, runner)
    });
    assert.equal(created.statusCode, 201, created.body);
    const roomId = (created.json() as RaceRoom).id;
    const checkpoints = taggedCourse().checkpoints;

    // Refused before any write, more times than the limit: none counts.
    for (let i = 0; i < 12; i += 1) {
      const invalid = await app.inject({
        method: "PUT",
        url: `/race-rooms/${roomId}/course`,
        payload: { course: { checkpoints } },
        headers: auth(app, runner)
      });
      assert.equal(invalid.statusCode, 400, invalid.body);
      // No route yet and none sent: refused before the write.
      const noRoute = await resaveCourse(app, roomId, runner, checkpoints);
      assert.equal(noRoute.statusCode, 400, noRoute.body);
    }

    // Ten saves that write: the first with the route, then a keyed one, then eight more.
    assert.equal((await saveCourseOn(app, roomId, runner)).statusCode, 200);
    const keyed = await resaveCourse(app, roomId, runner, checkpoints, "limit-writes-key");
    assert.equal(keyed.statusCode, 200, keyed.body);
    for (let i = 0; i < 8; i += 1) {
      assert.equal((await resaveCourse(app, roomId, runner, checkpoints)).statusCode, 200, `save ${i + 3}`);
    }
    const limited = await resaveCourse(app, roomId, runner, checkpoints, "limit-writes-fresh-key");
    assert.equal(limited.statusCode, 429, limited.body);
    assert.deepEqual(limited.json(), { error: "Too many requests" });
    assert.ok(Number(limited.headers["retry-after"]) > 60 * 59);
    // The refused key was released, not left in progress: the same request is 429 again, not 409.
    assert.equal((await resaveCourse(app, roomId, runner, checkpoints, "limit-writes-fresh-key")).statusCode, 429);

    // A retry of a save that already committed is its replay, past the limit too.
    const replay = await resaveCourse(app, roomId, runner, checkpoints, "limit-writes-key");
    assert.equal(replay.statusCode, 200, replay.body);
    assertNoPaidPlan(replay.json(), "replay past the limit", "runner");
    assert.equal((replay.json() as RaceRoom).id, roomId);
  });
});

/** `PATCH /race-rooms/:roomId/race-start`: the start alone, as onboarding sets it. */
function patchRaceStart(app: App, roomId: string, user: string, raceStartAt: unknown, idempotencyKey?: string) {
  return app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/race-start`,
    payload: { raceStartAt },
    headers: { ...auth(app, user), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }
  });
}

const hoursAfter = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * 3600 * 1000).toISOString();

test("unpaid race: the runner sets the start without re-sending the course; the reply is the teaser and the finish moves with the start", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-race-start";
    const raceStartAt = futureStart();
    const roomId = await raceWithCourse(app, runner, "Teaser start", { raceStartAt });
    const computed = await computeForRoom(app, roomId, runner);
    assert.equal(computed.statusCode, 200, computed.body);
    const plan = computed.json() as PacingEstimate;
    assert.equal((await attachById(app, roomId, runner, plan.id)).statusCode, 200);
    const midCourse = new Set(MID_COURSE);
    const before = await teaserFinishes(app, roomId, runner, raceStartAt, "before the move", midCourse);
    assertOneFinish(before, "before the move", plan.expectedFinishElapsedSeconds);

    const moved = hoursAfter(raceStartAt, 2);
    const patched = await patchRaceStart(app, roomId, runner, moved);
    assert.equal(patched.statusCode, 200, patched.body);
    assertNoPaidPlan(patched.json(), "runner PATCH race-start", "runner");
    const body = patched.json() as RaceRoom;
    assert.equal(body.raceStartAt, moved);
    assert.equal(body.activatedAt, moved);
    assert.equal(body.entitlement.status, "unpaid");
    assert.equal(body.pacingEstimateId, plan.id, "the plan stays attached");
    assert.deepEqual(body.pacingEstimate?.aidEtas, []);

    // The same finish, counted from the new start: projection and schedule both moved with it.
    const after = await teaserFinishes(app, roomId, runner, moved, "after the move", midCourse);
    assertOneFinish(after, "after the move", plan.expectedFinishElapsedSeconds);
    withinASecond(after.projection, before.projection, "teaser projection finish from the new start");
    withinASecond(after.schedule, before.schedule, "teaser schedule finish from the new start");
    assert.deepEqual(after.stops, ["start", "finish"]);
  });
});

test("unpaid race: PATCH race-start is 402 for crew, 403 for crew who cannot edit the course; a keyed replay after a refund is the teaser", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-race-start-gates";
    const chief = "chief-teaser-race-start-gates";
    const crew = "crew-teaser-race-start-gates";
    const room = await setUpUnpaidRace(app, runner, "Teaser start gates");
    // Crew can only be on an unpaid race from before it was unpaid (a refund).
    await setEntitlement(app, room.id, runner, "paid");
    assert.equal((await joinByCode(app, room.joinCode, chief)).statusCode, 200);
    assert.equal((await joinByCode(app, room.joinCode, crew)).statusCode, 200);
    const promoted = await app.inject({
      method: "PATCH",
      url: `/race-rooms/${room.id}/members/${chief}`,
      payload: { role: "crew_chief" },
      headers: auth(app, runner)
    });
    assert.equal(promoted.statusCode, 200, promoted.body);

    // While paid: a keyed start change answers the whole room, as any paid write does.
    const keyed = await patchRaceStart(app, room.id, runner, hoursAfter(RACE_START_AT, 1), "teaser-race-start-key");
    assert.equal(keyed.statusCode, 200, keyed.body);
    assert.ok((keyed.json() as RaceRoom).course?.baselineTrack, "paid: whole");

    await setEntitlement(app, room.id, runner, "unpaid");
    const chiefMove = await patchRaceStart(app, room.id, chief, hoursAfter(RACE_START_AT, 2));
    assert.equal(chiefMove.statusCode, 402, chiefMove.body);
    assert.equal(Object.hasOwn(chiefMove.json() as object, "course"), false);
    const crewMove = await patchRaceStart(app, room.id, crew, hoursAfter(RACE_START_AT, 2));
    assert.equal(crewMove.statusCode, 403, crewMove.body);
    assert.equal((await roomOf(app, room.id, runner)).raceStartAt, hoursAfter(RACE_START_AT, 1), "neither wrote");

    // The runner's retry, after the refund: the room as it is now, the teaser.
    const replay = await patchRaceStart(app, room.id, runner, hoursAfter(RACE_START_AT, 1), "teaser-race-start-key");
    assert.equal(replay.statusCode, 200, replay.body);
    assertNoPaidPlan(replay.json(), "refunded keyed PATCH race-start replay", "runner");
    assert.equal((replay.json() as RaceRoom).raceStartAt, hoursAfter(RACE_START_AT, 1));
  });
});

test("unpaid race: a start change counts toward the course-save limit, with course saves; refused payloads and replays do not", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-race-start-limit";
    const checkpoints = taggedCourse().checkpoints;
    // A paid race of the runner's, set up first: its writes are not limited.
    const paidRoom = await raceWithCourse(app, runner, "Start limit, paid"); // save 1
    await pay(app, paidRoom, runner);
    const roomId = await raceWithCourse(app, runner, "Start limit, unpaid"); // save 2

    // Refused before any write, more times than the limit: none counts.
    for (let i = 0; i < 12; i += 1) {
      const offset = await patchRaceStart(app, roomId, runner, "2026-08-15T06:00:00-07:00");
      assert.equal(offset.statusCode, 400, offset.body);
    }

    const keyed = await patchRaceStart(app, roomId, runner, hoursAfter(RACE_START_AT, 1), "start-limit-key"); // 3
    assert.equal(keyed.statusCode, 200, keyed.body);
    assertNoPaidPlan(keyed.json(), "keyed PATCH race-start", "runner");
    for (let i = 0; i < 7; i += 1) {
      // Saves 4 to 10: course saves and start changes share the budget.
      const write =
        i % 2 === 0
          ? await patchRaceStart(app, roomId, runner, hoursAfter(RACE_START_AT, 2 + i))
          : await resaveCourse(app, roomId, runner, checkpoints);
      assert.equal(write.statusCode, 200, `save ${i + 4}: ${write.body}`);
    }
    const limited = await patchRaceStart(app, roomId, runner, hoursAfter(RACE_START_AT, 20), "start-limit-fresh-key");
    assert.equal(limited.statusCode, 429, limited.body);
    assert.deepEqual(limited.json(), { error: "Too many requests" });
    assert.ok(Number(limited.headers["retry-after"]) > 60 * 59);
    // The refused key was released: the same request is 429 again, not 409.
    assert.equal(
      (await patchRaceStart(app, roomId, runner, hoursAfter(RACE_START_AT, 20), "start-limit-fresh-key")).statusCode,
      429
    );
    assert.equal((await resaveCourse(app, roomId, runner, checkpoints)).statusCode, 429, "a course save is refused too");
    assert.notEqual((await roomOf(app, roomId, runner)).raceStartAt, hoursAfter(RACE_START_AT, 20), "nothing written");

    // A retry of a change that already committed is its replay, past the limit too.
    const replay = await patchRaceStart(app, roomId, runner, hoursAfter(RACE_START_AT, 1), "start-limit-key");
    assert.equal(replay.statusCode, 200, replay.body);
    assertNoPaidPlan(replay.json(), "PATCH race-start replay past the limit", "runner");

    // The paid race is not limited.
    const paidMove = await patchRaceStart(app, paidRoom, runner, hoursAfter(RACE_START_AT, 3));
    assert.equal(paidMove.statusCode, 200, paidMove.body);
  });
});
