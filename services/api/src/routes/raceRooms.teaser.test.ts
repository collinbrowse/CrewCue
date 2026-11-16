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
      // Off the straight line from start to finish, so an interpolated row cannot pass for it.
      { checkpointId: "aid-3", clockArrivalAt: clock(24_000), elapsedSeconds: 24_000 }
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
  await setUpCourseAndPlan(app, room.id, runner);
  return room;
}

/** Course (with its route) and plan of record on an existing race, as the runner sets it up. */
async function setUpCourseAndPlan(app: App, roomId: string, runner: string): Promise<void> {
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

  const attach = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/pacing-estimate`,
    payload: { estimate: estimateFor(`teaser-estimate-${roomId}`) },
    headers: auth(app, runner)
  });
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

/** Checkpoints whose ETA the teaser withholds on the fixture course (`aid-2` is the first aid). */
const LOCKED_IDS = new Set(["aid-1", "aid-3"]);
const ETA_KEYS = [
  "clockArrivalAt",
  "elapsedSeconds",
  "plannedElapsedSecondsAtCross",
  "liveProjectedElapsedSeconds",
  "frozenPlanElapsedSeconds"
];

/**
 * Fails if `body` carries the plan of an unpaid race: the plan curve anywhere, an ETA for a
 * locked checkpoint, or (for anyone but the runner) any estimate at all.
 */
function assertNoPaidPlan(
  body: unknown,
  label: string,
  viewer: "runner" | "other",
  locked: ReadonlySet<string> = LOCKED_IDS
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
    if (typeof record.checkpointId === "string" && locked.has(record.checkpointId)) {
      for (const key of ETA_KEYS) {
        assert.equal(Object.hasOwn(record, key), false, `${label}: ${record.checkpointId} ETA at ${path}.${key}`);
      }
    }
    for (const [key, child] of Object.entries(record)) walk(child, `${path}.${key}`);
  };
  walk(body, "$");
}

/** An unpaid race with a crew member left over from when it was paid (a refund). */
async function setUpRefundedRace(app: App, runner: string, crew: string) {
  const room = await setUpUnpaidRace(app, runner);
  await setEntitlement(app, room.id, runner, "paid");
  assert.equal((await joinByCode(app, room.joinCode, crew)).statusCode, 200);
  await setEntitlement(app, room.id, runner, "unpaid");
  return room;
}

test("unpaid race: no 200 a member can get carries the plan curve or a locked checkpoint's ETA", async () => {
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
        run: () =>
          app.inject({
            method: "PUT",
            url: `/race-rooms/${room.id}/pacing-estimate`,
            payload: { pacingEstimateId: `teaser-estimate-${room.id}` },
            headers: auth(app, runner)
          })
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

    // The re-save kept the plan of record, and the teaser still shows its first aid ETA.
    const roomRead = (await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom };
    assert.deepEqual(roomRead.room.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), ["aid-2"]);

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

test("unpaid race: POST /pacing-estimates and the attach answer the runner with the teaser estimate, stored whole", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-estimate";
    const room = await setUpUnpaidRace(app, runner);

    // The native client's recompute: POST /pacing-estimates, then attach by id.
    const computed = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      payload: { roomId: room.id, trigger: "auto" },
      headers: auth(app, runner)
    });
    assert.equal(computed.statusCode, 200, computed.body);
    const estimate = computed.json() as PacingEstimate;
    assert.deepEqual(estimate.aidEtas.map((eta) => eta.checkpointId), ["aid-2"]);
    assert.ok(estimate.expectedFinishAt, "the finish ETA stays");
    assertNoPaidPlan(estimate, "runner POST /pacing-estimates", "runner");

    const attach = await app.inject({
      method: "PUT",
      url: `/race-rooms/${room.id}/pacing-estimate`,
      payload: { pacingEstimateId: estimate.id },
      headers: auth(app, runner)
    });
    assert.equal(attach.statusCode, 200, attach.body);
    const attached = (attach.json() as { estimate: PacingEstimate }).estimate;
    assert.deepEqual(attached.aidEtas.map((eta) => eta.checkpointId), ["aid-2"]);
    assertNoPaidPlan(attach.json(), "runner PUT pacing-estimate", "runner");

    // Paying unlocks every aid ETA the estimator priced: only the replies were shaped.
    await pay(app, room.id, runner);
    const full = ((await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom }).room;
    assert.equal(full.pacingEstimateId, estimate.id);
    assert.deepEqual(full.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), ["aid-1", "aid-2", "aid-3"]);
    assert.ok(full.course?.baselineTrack, "the estimate's plan curve was attached");
  });
});

test("unpaid race: crew get 402 from POST /pacing-estimates, even on Recalculate", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-crew-estimate";
    const crew = "crew-teaser-crew-estimate";
    const room = await setUpRefundedRace(app, runner, crew);
    for (const trigger of ["recalculate", "cold_start"]) {
      const response = await app.inject({
        method: "POST",
        url: "/pacing-estimates",
        payload: { roomId: room.id, trigger },
        headers: auth(app, crew)
      });
      assert.equal(response.statusCode, 402, `crew ${trigger}: ${response.body}`);
      assert.equal(Object.hasOwn(response.json() as object, "aidEtas"), false);
    }
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

/** Every mid-course checkpoint: for reads where the teaser shows no aid ETA at all. */
const ALL_MID_COURSE = new Set(["aid-1", "aid-2", "aid-3"]);

type CourseCheckpoints = ReturnType<typeof taggedCourse>["checkpoints"];

/** PUT course with no route overlay: a re-save, so the attached plan of record is kept. */
function resaveCourse(app: App, roomId: string, user: string, checkpoints: CourseCheckpoints, idempotencyKey?: string) {
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: taggedCourse().plannedPaceSecondsPerKm,
      course: { checkpoints },
      raceStartAt: RACE_START_AT
    },
    headers: { ...auth(app, user), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }
  });
}

/**
 * The runner's three teaser reads of the race, each checked for the plan, and which stops they
 * show: the attached estimate's aid ETAs, the projection's splits and the schedule's stops.
 */
async function readTeaser(app: App, roomId: string, runner: string, label: string, locked: ReadonlySet<string> = LOCKED_IDS) {
  const reads = {
    room: await get(app, `/race-rooms/${roomId}`, runner),
    projection: await get(app, `/race-rooms/${roomId}/projection`, runner),
    schedule: await get(app, `/race-rooms/${roomId}/schedule`, runner)
  };
  for (const [name, response] of Object.entries(reads)) {
    assert.equal(response.statusCode, 200, `${label}: GET ${name}: ${response.body}`);
    assertNoPaidPlan(response.json(), `${label}: GET ${name}`, "runner", locked);
  }
  const schedule = parseCrewScheduleSheet(reads.schedule.json());
  return {
    aidEtas: (reads.room.json() as { room: RaceRoom }).room.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId),
    splits: (reads.projection.json() as RaceRoomProjection).checkpointSplits.map((row) => row.checkpointId),
    stops: schedule.stops.map((stop) => stop.checkpointId),
    locked: schedule.locked?.checkpointIds
  };
}

test("unpaid race: re-tagging the course never moves the teaser to another stop", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-retag";
    const room = await setUpUnpaidRace(app, runner);
    // aid-2 is the pinned stop. Move the `aid` tag to each other stop, then drop every tag.
    const layouts: Array<Record<string, Array<"aid" | "water">>> = [
      { "aid-1": ["aid"], "aid-2": ["water"], "aid-3": ["water"] },
      { "aid-1": ["water"], "aid-2": ["water"], "aid-3": ["aid"] },
      { "aid-1": [], "aid-2": [], "aid-3": [] }
    ];
    for (const [index, tags] of layouts.entries()) {
      const label = `re-tag ${index + 1}`;
      const checkpoints = taggedCourse().checkpoints.map((checkpoint) => ({
        ...checkpoint,
        tags: tags[checkpoint.id] ?? checkpoint.tags
      }));
      const saved = await resaveCourse(app, room.id, runner, checkpoints);
      assert.equal(saved.statusCode, 200, `${label}: ${saved.body}`);
      assertNoPaidPlan(saved.json(), `${label}: PUT course`, "runner");
      assert.deepEqual(await readTeaser(app, room.id, runner, label), {
        aidEtas: ["aid-2"],
        splits: ["aid-2"],
        stops: ["start", "aid-2", "finish"],
        locked: ["aid-1", "aid-3"]
      });
    }

    // Moving the pinned stop itself (same id) onto aid-3's spot would read aid-3's ETA off the
    // plan curve, so it shows nothing. The save keeps a sent distance that disagrees with the
    // route, so the distance alone moves it.
    const fixture = taggedCourse().checkpoints;
    const aid3 = fixture.find((checkpoint) => checkpoint.id === "aid-3")!;
    const moved = fixture
      .filter((checkpoint) => checkpoint.id !== "aid-3")
      .map((checkpoint) =>
        checkpoint.id === "aid-2"
          ? {
              ...checkpoint,
              latitude: aid3.latitude,
              longitude: aid3.longitude,
              distanceMetersFromStart: aid3.distanceMetersFromStart
            }
          : checkpoint
      );
    const saved = await resaveCourse(app, room.id, runner, moved);
    assert.equal(saved.statusCode, 200, saved.body);
    assertNoPaidPlan(saved.json(), "moved pinned stop: PUT course", "runner", ALL_MID_COURSE);
    assert.deepEqual(await readTeaser(app, room.id, runner, "moved pinned stop", ALL_MID_COURSE), {
      aidEtas: [],
      splits: [],
      stops: ["start", "finish"],
      locked: ["aid-1", "aid-2"]
    });
  });
});

test("unpaid race: deleting the pinned stop leaves the finish only, until a new estimate picks again", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-delete-pin";
    const room = await setUpUnpaidRace(app, runner);
    const withoutPinned = taggedCourse().checkpoints.filter((checkpoint) => checkpoint.id !== "aid-2");
    const saved = await resaveCourse(app, room.id, runner, withoutPinned);
    assert.equal(saved.statusCode, 200, saved.body);
    assertNoPaidPlan(saved.json(), "pinned stop deleted: PUT course", "runner", ALL_MID_COURSE);
    assert.deepEqual(await readTeaser(app, room.id, runner, "pinned stop deleted", ALL_MID_COURSE), {
      aidEtas: [],
      splits: [],
      stops: ["start", "finish"],
      locked: ["aid-1", "aid-3"]
    });

    // A recompute is a new estimate: it picks the first priced stop tagged `aid`, now aid-3.
    const onlyAid3Shown = new Set(["aid-1", "aid-2"]);
    const computed = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      payload: { roomId: room.id, trigger: "auto" },
      headers: auth(app, runner)
    });
    assert.equal(computed.statusCode, 200, computed.body);
    assert.deepEqual((computed.json() as PacingEstimate).aidEtas.map((eta) => eta.checkpointId), ["aid-3"]);
    assertNoPaidPlan(computed.json(), "recompute: POST /pacing-estimates", "runner", onlyAid3Shown);
    const attach = await app.inject({
      method: "PUT",
      url: `/race-rooms/${room.id}/pacing-estimate`,
      payload: { pacingEstimateId: (computed.json() as PacingEstimate).id },
      headers: auth(app, runner)
    });
    assert.equal(attach.statusCode, 200, attach.body);
    assertNoPaidPlan(attach.json(), "recompute: PUT pacing-estimate", "runner", onlyAid3Shown);
    assert.deepEqual(await readTeaser(app, room.id, runner, "after recompute", onlyAid3Shown), {
      aidEtas: ["aid-3"],
      splits: ["aid-3"],
      stops: ["start", "aid-3", "finish"],
      locked: ["aid-1"]
    });
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
      assert.deepEqual(shownAid(response), ["aid-2"]);
    }

    // The key is first used while paid, so its stored body is the whole plan.
    await setEntitlement(app, room.id, runner, "paid");
    const paidSave = await resaveCourse(app, room.id, runner, checkpoints, "k-paid-1");
    assert.equal(paidSave.statusCode, 200, paidSave.body);
    assert.deepEqual(shownAid(paidSave), ["aid-1", "aid-2", "aid-3"]);
    assert.ok((paidSave.json() as RaceRoom).course?.baselineTrack, "paid saves are unchanged");

    // Refunded: the replay answers from the room as it is now.
    await setEntitlement(app, room.id, runner, "unpaid");
    const replay = await resaveCourse(app, room.id, runner, checkpoints, "k-paid-1");
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal((replay.json() as RaceRoom).entitlement.status, "unpaid");
    assertNoPaidPlan(replay.json(), "refunded keyed PUT course replay", "runner");
    assert.deepEqual(shownAid(replay), ["aid-2"]);
  });
});

test("unpaid race: a keyed POST /race-rooms retry answers the room as it is now, shaped for the caller", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-idem-create";
    const payload = { teamId: "team-1", athleteId: runner, name: "Keyed 50k", creatorRole: "athlete" };
    const create = (user: string) =>
      app.inject({
        method: "POST",
        url: "/race-rooms",
        payload,
        headers: { ...auth(app, user), "idempotency-key": "k-create-1" }
      });
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
      assert.equal(Object.hasOwn(body, "teaserCheckpoint"), false);
      return body;
    };

    const unpaid = await retry("unpaid retry");
    assertNoPaidPlan(unpaid, "unpaid POST /race-rooms retry", "runner");
    assert.deepEqual(unpaid.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), ["aid-2"]);

    await setEntitlement(app, roomId, runner, "paid");
    const paid = await retry("paid retry");
    assert.deepEqual(paid.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), ["aid-1", "aid-2", "aid-3"]);
    assert.ok(paid.course?.baselineTrack, "paid rooms are unchanged");

    await setEntitlement(app, roomId, runner, "unpaid");
    assertNoPaidPlan(await retry("refunded retry"), "refunded POST /race-rooms retry", "runner");

    // Someone else sending the same key and body is not handed the runner's race.
    const stranger = await create("stranger-teaser-idem-create");
    assert.equal(stranger.statusCode, 409, stranger.body);
    assert.equal(Object.hasOwn(stranger.json() as object, "id"), false);
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
    assert.deepEqual(body.room.pacingEstimate?.aidEtas.map((eta) => eta.checkpointId), ["aid-2"]);
  });
});

test("unpaid race: GET /me/export returns each estimate as the runner was shown it; paying exports them whole", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-export";
    const room = await setUpUnpaidRace(app, runner);
    const computed = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      payload: { roomId: room.id, trigger: "auto" },
      headers: auth(app, runner)
    });
    assert.equal(computed.statusCode, 200, computed.body);
    const computedId = (computed.json() as PacingEstimate).id;
    const attachedId = `teaser-estimate-${room.id}`;

    const exported = async () => {
      const response = await get(app, "/me/export", runner);
      assert.equal(response.statusCode, 200, response.body);
      const byId = new Map(
        (response.json() as { pacingEstimates: PacingEstimate[] }).pacingEstimates.map((estimate) => [
          estimate.id,
          estimate.aidEtas.map((eta) => eta.checkpointId)
        ])
      );
      return { body: response.json() as unknown, byId };
    };

    const unpaid = await exported();
    assertNoPaidPlan(unpaid.body, "runner GET /me/export", "runner");
    assert.deepEqual(unpaid.byId.get(computedId), ["aid-2"], "the computed estimate, as POST answered it");
    assert.deepEqual(unpaid.byId.get(attachedId), ["aid-2"], "the attached plan, as the room shows it");

    await pay(app, room.id, runner);
    const paid = await exported();
    assert.deepEqual(paid.byId.get(computedId), ["aid-1", "aid-2", "aid-3"]);
    assert.deepEqual(paid.byId.get(attachedId), ["aid-1", "aid-2", "aid-3"]);
  });
});

test("unpaid race: the room-less estimator answers the teaser shape for a course copied from the room", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-roomless";
    const room = await setUpUnpaidRace(app, runner);
    const teaser = ((await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom }).room;
    const response = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      payload: { raceStartAt: RACE_START_AT, checkpoints: teaser.course?.checkpoints },
      headers: auth(app, runner)
    });
    assert.equal(response.statusCode, 200, response.body);
    const estimate = response.json() as PacingEstimate;
    assert.deepEqual(estimate.aidEtas.map((eta) => eta.checkpointId), ["aid-2"]);
    assert.ok(estimate.expectedFinishAt, "the finish ETA stays");
    assertNoPaidPlan(estimate, "runner room-less POST /pacing-estimates", "runner");

    const exported = await get(app, "/me/export", runner);
    assertNoPaidPlan(exported.json(), "runner GET /me/export after a room-less estimate", "runner");
    const row = (exported.json() as { pacingEstimates: PacingEstimate[] }).pacingEstimates.find(
      (candidate) => candidate.id === estimate.id
    );
    assert.deepEqual(row?.aidEtas.map((eta) => eta.checkpointId), ["aid-2"]);
  });
});

test("unpaid race: a course re-saved to start at a priced stop does not show that stop's ETA as the start", async () => {
  await withApp(async (app) => {
    const runner = "runner-teaser-start-row";
    const room = await setUpUnpaidRace(app, runner);
    const fromAid3 = taggedCourse().checkpoints.filter((checkpoint) => ["aid-3", "finish"].includes(checkpoint.id));
    const saved = await resaveCourse(app, room.id, runner, fromAid3);
    assert.equal(saved.statusCode, 200, saved.body);

    const scheduleRead = await get(app, `/race-rooms/${room.id}/schedule`, runner);
    assert.equal(scheduleRead.statusCode, 200, scheduleRead.body);
    const schedule = parseCrewScheduleSheet(scheduleRead.json());
    assert.deepEqual(schedule.stops.map((stop) => stop.checkpointId), ["aid-3", "finish"]);
    // The stored plan prices aid-3 at 24 000 s. As the first row it is read off the shown anchors
    // (the start and the finish) instead, about 21 000 s.
    const first = schedule.stops[0]!;
    assert.ok(Math.abs(first.elapsedSeconds - 21_000) < 60, `start row elapsed ${first.elapsedSeconds}`);
    assert.ok(Math.abs((first.movingElapsedSeconds ?? 0) - 21_000) < 60);

    const roomRead = (await get(app, `/race-rooms/${room.id}`, runner)).json() as { room: RaceRoom };
    assert.deepEqual(roomRead.room.pacingEstimate?.aidEtas, []);
    const projection = (await get(app, `/race-rooms/${room.id}/projection`, runner)).json() as RaceRoomProjection;
    assert.deepEqual(projection.checkpointSplits, []);
  });
});
