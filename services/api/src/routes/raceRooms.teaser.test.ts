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
function assertNoPaidPlan(body: unknown, label: string, viewer: "runner" | "other"): void {
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
    if (typeof record.checkpointId === "string" && LOCKED_IDS.has(record.checkpointId)) {
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
