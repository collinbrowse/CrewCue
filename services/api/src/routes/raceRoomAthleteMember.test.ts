/**
 * The server decides a race room's athlete from membership, and the plan of record follows that
 * athlete member: the creator when they create as the athlete, else whoever accepts the room's
 * athlete invite. A room with no athlete member computes no plan.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseActivityHistoryRef, parsePacingEstimate, type RaceRoom } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { resetActivityHistoryStoreForTests } from "../lib/activityHistoryStore.js";
import { listPacingEstimatesForAthlete, resetPacingEstimateStoreForTests } from "../lib/pacingEstimateStore.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";
import { getRaceRoom, saveRaceRoom } from "./raceRooms.js";

type TestApp = ReturnType<typeof buildApp>;

const RACE_START_AT = "2026-08-15T13:00:00.000Z";
const CHIEF = "athlete-member-chief";
const RUNNER = "athlete-member-runner";
const MEMBER = "athlete-member-crew";
const ELSEWHERE = "athlete-member-elsewhere";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "activity-long-trail.gpx"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found");
}

const pacingDir = findPacingFixturesDir();

async function withApp(run: (ctx: { app: TestApp; token: (sub: string) => string }) => Promise<void>): Promise<void> {
  await resetActivityHistoryStoreForTests();
  await resetPacingEstimateStoreForTests();
  const app = buildApp();
  await app.ready();
  const token = (sub: string) => app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} });
  try {
    await run({ app, token });
  } finally {
    await app.close();
    await resetActivityHistoryStoreForTests();
    await resetPacingEstimateStoreForTests();
  }
}

async function createRoom(
  app: TestApp,
  token: (sub: string) => string,
  creator: string,
  payload: Record<string, unknown>
): Promise<RaceRoom> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", name: "Athlete member", ...payload },
    headers: { authorization: `Bearer ${token(creator)}` }
  });
  assert.equal(created.statusCode, 201, created.body);
  return created.json() as RaceRoom;
}

/** A paid room with a course, created by crew. */
async function crewRoom(app: TestApp, token: (sub: string) => string, athleteId?: string): Promise<string> {
  const room = await createRoom(app, token, CHIEF, {
    creatorRole: "crew_chief",
    ...(athleteId !== undefined ? { athleteId } : {})
  });
  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${token(CHIEF)}` }
  });
  assert.equal(paid.statusCode, 200, paid.body);
  const fixture = load50kCourseWithAids();
  const course = await app.inject({
    method: "PUT",
    url: `/race-rooms/${room.id}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: { checkpoints: fixture.checkpoints },
      routeOverlayLayer: fixture.routeOverlayLayer,
      raceStartAt: RACE_START_AT
    },
    headers: { authorization: `Bearer ${token(CHIEF)}` }
  });
  assert.equal(course.statusCode, 200, course.body);
  return room.id;
}

function invite(app: TestApp, bearer: string, roomId: string, sub: string, role: string) {
  return app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: `${sub}@example.com`, role },
    headers: { authorization: `Bearer ${bearer}` }
  });
}

async function acceptInvite(app: TestApp, bearer: string, roomId: string, inviteToken: string) {
  const accepted = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: inviteToken },
    headers: { authorization: `Bearer ${bearer}` }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  return accepted.json() as { room: RaceRoom; assignedRole: string };
}

async function ingest(app: TestApp, bearer: string, externalId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/activity-history/gpx",
    headers: { authorization: `Bearer ${bearer}` },
    payload: { gpxXml: readFileSync(resolve(pacingDir, "activity-long-trail.gpx"), "utf8"), externalId }
  });
  assert.ok(response.statusCode === 200 || response.statusCode === 201, response.body);
  return parseActivityHistoryRef(response.json()).id;
}

function compute(app: TestApp, bearer: string, roomId: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/pacing-estimates",
    headers: { authorization: `Bearer ${bearer}` },
    payload: { roomId, trigger: "cold_start", ...extra }
  });
}

function attach(app: TestApp, bearer: string, roomId: string) {
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/pacing-estimate`,
    headers: { authorization: `Bearer ${bearer}` },
    payload: { pacingEstimateId: "any-estimate", trigger: "cold_start" }
  });
}

function code(response: { json: () => unknown }): string | undefined {
  return (response.json() as { code?: string }).code;
}

test("a room created by crew has no athlete, whatever athleteId the request carries", async () => {
  await withApp(async ({ app, token }) => {
    // Its own creators: unpaid rooms count toward each creator's limit across tests.
    const byCrew = await createRoom(app, token, "athlete-member-chief-a", { athleteId: RUNNER, creatorRole: "crew_chief" });
    assert.equal(byCrew.athleteId, "");
    const byManager = await createRoom(app, token, "athlete-member-manager", { creatorRole: "team_manager" });
    assert.equal(byManager.athleteId, "");
  });
});

test("a crew-role creator who names themselves is the room's athlete", async () => {
  await withApp(async ({ app, token }) => {
    const manager = "athlete-member-chief-b";
    const room = await createRoom(app, token, manager, { athleteId: manager, creatorRole: "team_manager" });
    assert.equal(room.athleteId, manager);
    assert.equal(room.memberships[0]?.role, "team_manager");
  });
});

test("a room created by its athlete names the creator, not the athleteId in the request", async () => {
  await withApp(async ({ app, token }) => {
    const runner = "athlete-member-runner-b";
    const named = await createRoom(app, token, runner, { athleteId: ELSEWHERE, creatorRole: "athlete" });
    assert.equal(named.athleteId, runner);
    const unnamed = await createRoom(app, token, runner, {});
    assert.equal(unnamed.athleteId, runner);
    assert.equal(unnamed.memberships[0]?.role, "athlete");
  });
});

test("no plan before the athlete joins; once they accept the athlete invite it is built from their history", async () => {
  await withApp(async ({ app, token }) => {
    const roomId = await crewRoom(app, token);
    const runnerHistoryId = await ingest(app, token(RUNNER), "runner-run");
    await ingest(app, token(CHIEF), "chief-run");

    for (const extra of [{}, { trigger: "recalculate" }]) {
      const refused = await compute(app, token(CHIEF), roomId, extra);
      assert.equal(refused.statusCode, 409, refused.body);
      assert.equal(code(refused), "athlete_not_joined");
    }
    const attachRefused = await attach(app, token(CHIEF), roomId);
    assert.equal(attachRefused.statusCode, 409, attachRefused.body);
    assert.equal(code(attachRefused), "athlete_not_joined");

    // While the seat is empty only the creator may invite above crew_member, and only the athlete.
    const crewInvite = await invite(app, token(CHIEF), roomId, MEMBER, "crew_member");
    assert.equal(crewInvite.statusCode, 201, crewInvite.body);
    await acceptInvite(app, token(MEMBER), roomId, (crewInvite.json() as { token: string }).token);
    assert.equal((await invite(app, token(MEMBER), roomId, RUNNER, "athlete")).statusCode, 403);
    assert.equal((await invite(app, token(CHIEF), roomId, RUNNER, "crew_chief")).statusCode, 403);

    const athleteInvite = await invite(app, token(CHIEF), roomId, RUNNER, "athlete");
    assert.equal(athleteInvite.statusCode, 201, athleteInvite.body);
    const joined = await acceptInvite(app, token(RUNNER), roomId, (athleteInvite.json() as { token: string }).token);
    assert.equal(joined.assignedRole, "athlete");
    assert.equal(joined.room.athleteId, RUNNER);

    const seeded = await compute(app, token(CHIEF), roomId);
    assert.equal(seeded.statusCode, 200, seeded.body);
    assert.deepEqual(parsePacingEstimate(seeded.json()).historyRefIds, [runnerHistoryId]);

    // The seat is taken: a second athlete invite needs the athlete (owner) again.
    assert.equal((await invite(app, token(CHIEF), roomId, "athlete-member-second", "athlete")).statusCode, 403);
  });
});

test("an unpaid room created by crew still takes its athlete through the athlete invite", async () => {
  await withApp(async ({ app, token }) => {
    const chief = "athlete-member-chief-c";
    const room = await createRoom(app, token, chief, { creatorRole: "crew_chief" });
    // Other invites stay refused on an unpaid race.
    assert.equal((await invite(app, token(chief), room.id, MEMBER, "crew_member")).statusCode, 402);
    const athleteInvite = await invite(app, token(chief), room.id, RUNNER, "athlete");
    assert.equal(athleteInvite.statusCode, 201, athleteInvite.body);
    const joined = await acceptInvite(app, token(RUNNER), room.id, (athleteInvite.json() as { token: string }).token);
    assert.equal(joined.room.athleteId, RUNNER);
  });
});

test("the history of someone outside the room is never read for its plan", async () => {
  await withApp(async ({ app, token }) => {
    const elsewhereHistoryId = await ingest(app, token(ELSEWHERE), "elsewhere-run");

    // The athleteId sent on create is ignored, so the room has no athlete to read history from.
    const roomId = await crewRoom(app, token, ELSEWHERE);
    for (const historyRefIds of [[elsewhereHistoryId], ["no-such-history"], undefined]) {
      const refused = await compute(app, token(CHIEF), roomId, historyRefIds === undefined ? {} : { historyRefIds });
      assert.equal(refused.statusCode, 409, refused.body);
      assert.equal(code(refused), "athlete_not_joined");
    }

    // A room stored before this rule may still name someone who never joined: no plan either.
    const stored = await getRaceRoom(roomId);
    assert.ok(stored);
    await saveRaceRoom({ ...stored, athleteId: ELSEWHERE });
    for (const historyRefIds of [[elsewhereHistoryId], ["no-such-history"]]) {
      const refused = await compute(app, token(CHIEF), roomId, { historyRefIds });
      assert.equal(refused.statusCode, 409, refused.body);
      assert.equal(code(refused), "athlete_not_joined");
    }
    assert.deepEqual(await listPacingEstimatesForAthlete(ELSEWHERE), []);
  });
});
