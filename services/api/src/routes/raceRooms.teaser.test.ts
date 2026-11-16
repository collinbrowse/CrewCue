/**
 * Unpaid-race gating (runner and crew onboarding, PR 1). An unpaid race shows its runner a
 * teaser (the course, the finish ETA and the first aid station's ETA), enforced here on the
 * server. Crew get 402 on every gated read, chat, and join until the runner pays.
 * Runs in memory and on Postgres (CI).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCrewScheduleSheet,
  type CrewScheduleSheet,
  type PacingEstimate,
  type RaceRoom,
  type RaceRoomProjection
} from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { resetPacingEstimateStoreForTests } from "../lib/pacingEstimateStore.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";

type App = ReturnType<typeof buildApp>;

const RACE_START_AT = "2026-08-15T13:00:00.000Z";
const ALL_CHECKPOINTS = ["start", "aid-1", "aid-2", "aid-3", "finish"];
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

function estimateFor(id: string): PacingEstimate {
  const clock = (elapsedSeconds: number) => new Date(Date.parse(RACE_START_AT) + elapsedSeconds * 1000).toISOString();
  return {
    id,
    coldStart: true,
    expectedFinishAt: clock(30_000),
    expectedFinishElapsedSeconds: 30_000,
    aidEtas: [
      { checkpointId: "aid-1", clockArrivalAt: clock(6_000), elapsedSeconds: 6_000 },
      { checkpointId: "aid-2", clockArrivalAt: clock(12_000), elapsedSeconds: 12_000 },
      { checkpointId: "aid-3", clockArrivalAt: clock(21_000), elapsedSeconds: 21_000 }
    ],
    explanation: "Teaser fixture"
  };
}

/** A runner's race, set up while unpaid: create, course, plan of record. */
async function setUpUnpaidRace(app: App, runner: string): Promise<{ id: string; joinCode: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: runner, name: "Teaser 50k", creatorRole: "athlete" },
    headers: auth(app, runner)
  });
  assert.equal(created.statusCode, 201);
  const room = created.json() as { id: string; joinCode: string; entitlement: { status: string } };
  assert.equal(room.entitlement.status, "unpaid");

  const course = taggedCourse();
  const courseSave = await app.inject({
    method: "PUT",
    url: `/race-rooms/${room.id}/course`,
    payload: {
      plannedPaceSecondsPerKm: course.plannedPaceSecondsPerKm,
      course: { checkpoints: course.checkpoints },
      routeOverlayLayer: course.routeOverlayLayer,
      raceStartAt: RACE_START_AT
    },
    headers: auth(app, runner)
  });
  assert.equal(courseSave.statusCode, 200, courseSave.body);

  const attach = await app.inject({
    method: "PUT",
    url: `/race-rooms/${room.id}/pacing-estimate`,
    payload: { estimate: estimateFor(`teaser-estimate-${room.id}`) },
    headers: auth(app, runner)
  });
  assert.equal(attach.statusCode, 200, attach.body);
  return room;
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

test("unpaid race: the runner sets it up and reads only the teaser from room, projection and schedule", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser";
    const room = await setUpUnpaidRace(app, runner);

    const roomRead = await get(app, `/race-rooms/${room.id}`, runner);
    assert.equal(roomRead.statusCode, 200, roomRead.body);
    const teaserRoom = (roomRead.json() as { room: RaceRoom }).room;
    assert.equal(teaserRoom.entitlement.status, "unpaid");
    // The map still draws: geometry and the checkpoint list stay.
    assert.deepEqual(teaserRoom.course?.checkpoints.map((checkpoint) => checkpoint.id), ALL_CHECKPOINTS);
    assert.ok(teaserRoom.mapWorkspace?.layers.length, "route geometry stays for the map");
    // The plan curve would price every checkpoint, so it is withheld.
    assert.equal(teaserRoom.course?.baselineTrack, undefined);
    assert.deepEqual(teaserRoom.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), ["aid-2"]);
    assert.equal(teaserRoom.pacingEstimate?.expectedFinishAt, estimateFor("x").expectedFinishAt);

    const projectionRead = await get(app, `/race-rooms/${room.id}/projection`, runner);
    assert.equal(projectionRead.statusCode, 200, projectionRead.body);
    const projection = projectionRead.json() as RaceRoomProjection;
    assert.ok(projection.etaFinishPlanIso, "finish ETA stays");
    assert.ok(projection.courseLengthMeters > 0, "course-level fields stay");
    assert.deepEqual(projection.checkpointSplits.map((row) => row.checkpointId), ["aid-2"]);
    for (const eta of projection.remainingCheckpointEtas ?? []) {
      assert.equal(eta.checkpointId, "aid-2");
    }
    assert.deepEqual(projection.locked, { checkpointIds: ["aid-1", "aid-3"] });

    const scheduleRead = await get(app, `/race-rooms/${room.id}/schedule`, runner);
    assert.equal(scheduleRead.statusCode, 200, scheduleRead.body);
    const schedule = parseCrewScheduleSheet(scheduleRead.json());
    assert.deepEqual(schedule.stops.map((stop) => stop.checkpointId), ["start", "aid-2", "finish"]);
    assert.deepEqual(schedule.locked, { checkpointIds: ["aid-1", "aid-3"] });

    // The runner cannot send pings for an unpaid race: progress waits for the pass.
    const ping = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/pings`,
      payload: { latitude: 39.15, longitude: -120.25, recordedAt: new Date().toISOString() },
      headers: auth(app, runner)
    });
    assert.equal(ping.statusCode, 402);
  });
});

test("paying unlocks the full projection, schedule and room, with no locked field and the same teaser values", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-paid";
    const room = await setUpUnpaidRace(app, runner);
    const teaserSchedule = parseCrewScheduleSheet((await get(app, `/race-rooms/${room.id}/schedule`, runner)).json());
    const teaserProjection = (await get(app, `/race-rooms/${room.id}/projection`, runner)).json() as RaceRoomProjection;

    await pay(app, room.id, runner);

    const fullRoom = ((await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom }).room;
    assert.ok(fullRoom.course?.baselineTrack, "the plan curve comes back once paid");
    assert.deepEqual(fullRoom.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), ["aid-1", "aid-2", "aid-3"]);

    const projectionRead = await get(app, `/race-rooms/${room.id}/projection`, runner);
    assert.equal(projectionRead.statusCode, 200);
    const projection = projectionRead.json() as RaceRoomProjection;
    assert.equal(Object.hasOwn(projection, "locked"), false);
    assert.deepEqual(projection.checkpointSplits.map((row) => row.checkpointId), ALL_CHECKPOINTS);
    assert.equal(projection.etaFinishPlanIso, teaserProjection.etaFinishPlanIso);
    assert.deepEqual(
      projection.checkpointSplits.find((row) => row.checkpointId === "aid-2"),
      teaserProjection.checkpointSplits[0],
      "the teaser shows the real first-aid split, not a different number"
    );

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
