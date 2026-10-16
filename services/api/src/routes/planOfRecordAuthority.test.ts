/**
 * #538 / #493: only the race athlete's history may automatically create or recompute the
 * plan-of-record estimate. Crew may seed a cold start (no plan yet) or tap Recalculate, and
 * either way the estimate is built from the athlete's history, never the crew member's.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseActivityHistoryRef, parsePacingEstimate, type PacingEstimate } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { resetActivityHistoryStoreForTests } from "../lib/activityHistoryStore.js";
import { resetPacingEstimateStoreForTests } from "../lib/pacingEstimateStore.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";

type TestApp = ReturnType<typeof buildApp>;

const RACE_START_AT = "2026-08-15T13:00:00.000Z";
const ATHLETE = "plan-athlete";
const CHIEF = "plan-crew-chief";
const MEMBER = "plan-crew-member";

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

async function withRoom(
  run: (ctx: { app: TestApp; roomId: string; token: (sub: string) => string; athleteHistoryId: string }) => Promise<void>
): Promise<void> {
  await resetActivityHistoryStoreForTests();
  await resetPacingEstimateStoreForTests();
  const app = buildApp();
  await app.ready();
  const token = (sub: string) => app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} });
  try {
    const created = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: { teamId: "team-1", athleteId: ATHLETE, name: "Plan authority", creatorRole: "athlete" },
      headers: { authorization: `Bearer ${token(ATHLETE)}` }
    });
    assert.equal(created.statusCode, 201, created.body);
    const roomId = (created.json() as { id: string }).id;
    const paid = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/entitlement`,
      payload: { status: "paid" },
      headers: { authorization: `Bearer ${token(ATHLETE)}` }
    });
    assert.equal(paid.statusCode, 200, paid.body);
    const fixture = load50kCourseWithAids();
    const course = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/course`,
      payload: {
        plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
        course: { checkpoints: fixture.checkpoints },
        routeOverlayLayer: fixture.routeOverlayLayer,
        raceStartAt: RACE_START_AT
      },
      headers: { authorization: `Bearer ${token(ATHLETE)}` }
    });
    assert.equal(course.statusCode, 200, course.body);
    await join(app, roomId, token, CHIEF, "crew_chief");
    await join(app, roomId, token, MEMBER, "crew_member");
    const athleteHistoryId = await ingest(app, token(ATHLETE), "athlete-run");
    // Crew history exists too; it must never reach the athlete's plan.
    await ingest(app, token(CHIEF), "chief-run");
    await run({ app, roomId, token, athleteHistoryId });
  } finally {
    await app.close();
    await resetActivityHistoryStoreForTests();
    await resetPacingEstimateStoreForTests();
  }
}

async function join(app: TestApp, roomId: string, token: (sub: string) => string, sub: string, role: string) {
  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: `${sub}@example.com`, role },
    headers: { authorization: `Bearer ${token(ATHLETE)}` }
  });
  assert.equal(invite.statusCode, 201, invite.body);
  const accepted = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: (invite.json() as { token: string }).token },
    headers: { authorization: `Bearer ${token(sub)}` }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
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

function compute(app: TestApp, bearer: string, roomId: string, trigger?: string) {
  return app.inject({
    method: "POST",
    url: "/pacing-estimates",
    headers: { authorization: `Bearer ${bearer}` },
    payload: trigger === undefined ? { roomId } : { roomId, trigger }
  });
}

function attach(app: TestApp, bearer: string, roomId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/pacing-estimate`,
    headers: { authorization: `Bearer ${bearer}` },
    payload
  });
}

function code(response: { json: () => unknown }): string | undefined {
  return (response.json() as { code?: string }).code;
}

async function planOfRecordId(app: TestApp, bearer: string, roomId: string): Promise<string | undefined> {
  const response = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: { authorization: `Bearer ${bearer}` }
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json() as { pacingEstimateId?: string; room?: { pacingEstimateId?: string } };
  return body.room?.pacingEstimateId ?? body.pacingEstimateId;
}

test("athlete history drives automatic plan updates", async () => {
  await withRoom(async ({ app, roomId, token, athleteHistoryId }) => {
    const computed = await compute(app, token(ATHLETE), roomId);
    assert.equal(computed.statusCode, 200, computed.body);
    const estimate = parsePacingEstimate(computed.json());
    assert.deepEqual(estimate.historyRefIds, [athleteHistoryId]);
    const attached = await attach(app, token(ATHLETE), roomId, { pacingEstimateId: estimate.id, trigger: "auto" });
    assert.equal(attached.statusCode, 200, attached.body);
    assert.equal(await planOfRecordId(app, token(ATHLETE), roomId), estimate.id);
  });
});

test("crew cannot trigger an automatic recompute", async () => {
  await withRoom(async ({ app, roomId, token }) => {
    for (const trigger of [undefined, "auto"]) {
      const response = await compute(app, token(CHIEF), roomId, trigger);
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(code(response), "plan_authority");
    }
  });
});

test("crew seeds a cold start from the athlete's history, once", async () => {
  await withRoom(async ({ app, roomId, token, athleteHistoryId }) => {
    const seeded = await compute(app, token(CHIEF), roomId, "cold_start");
    assert.equal(seeded.statusCode, 200, seeded.body);
    const estimate = parsePacingEstimate(seeded.json());
    assert.deepEqual(estimate.historyRefIds, [athleteHistoryId]);
    const attached = await attach(app, token(CHIEF), roomId, { pacingEstimateId: estimate.id, trigger: "cold_start" });
    assert.equal(attached.statusCode, 200, attached.body);
    assert.equal(await planOfRecordId(app, token(CHIEF), roomId), estimate.id);

    const again = await compute(app, token(CHIEF), roomId, "cold_start");
    assert.equal(again.statusCode, 403, again.body);
    assert.equal(code(again), "plan_authority");
    const reattach = await attach(app, token(CHIEF), roomId, { pacingEstimateId: estimate.id, trigger: "cold_start" });
    assert.equal(reattach.statusCode, 403, reattach.body);
    assert.equal(code(reattach), "plan_authority");
  });
});

test("crew Recalculate rebuilds from the athlete's history", async () => {
  await withRoom(async ({ app, roomId, token, athleteHistoryId }) => {
    const first = parsePacingEstimate((await compute(app, token(ATHLETE), roomId)).json());
    assert.equal((await attach(app, token(ATHLETE), roomId, { pacingEstimateId: first.id })).statusCode, 200);

    const recalculated = await compute(app, token(CHIEF), roomId, "recalculate");
    assert.equal(recalculated.statusCode, 200, recalculated.body);
    const estimate: PacingEstimate = parsePacingEstimate(recalculated.json());
    assert.deepEqual(estimate.historyRefIds, [athleteHistoryId]);
    const attached = await attach(app, token(CHIEF), roomId, { pacingEstimateId: estimate.id, trigger: "recalculate" });
    assert.equal(attached.statusCode, 200, attached.body);

    const auto = await attach(app, token(CHIEF), roomId, { pacingEstimateId: estimate.id });
    assert.equal(auto.statusCode, 403, auto.body);
    assert.equal(code(auto), "plan_authority");
  });
});

test("crew cannot make their own history the plan of record", async () => {
  await withRoom(async ({ app, roomId, token }) => {
    const fixture = load50kCourseWithAids();
    const own = await app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${token(CHIEF)}` },
      payload: { raceStartAt: RACE_START_AT, checkpoints: fixture.checkpoints }
    });
    assert.equal(own.statusCode, 200, own.body);
    const estimate = parsePacingEstimate(own.json());

    const byId = await attach(app, token(CHIEF), roomId, { pacingEstimateId: estimate.id, trigger: "recalculate" });
    assert.equal(byId.statusCode, 403, byId.body);
    assert.equal(code(byId), "plan_authority");
    const bySnapshot = await attach(app, token(CHIEF), roomId, { estimate, trigger: "recalculate" });
    assert.equal(bySnapshot.statusCode, 403, bySnapshot.body);
    assert.equal(code(bySnapshot), "plan_authority");
    assert.equal(await planOfRecordId(app, token(CHIEF), roomId), undefined);
  });
});

test("crew members without race-setup rights cannot change the plan", async () => {
  await withRoom(async ({ app, roomId, token }) => {
    const response = await compute(app, token(MEMBER), roomId, "recalculate");
    assert.equal(response.statusCode, 403, response.body);
  });
});

test("unknown triggers are rejected", async () => {
  await withRoom(async ({ app, roomId, token }) => {
    const computed = await compute(app, token(ATHLETE), roomId, "sometimes");
    assert.equal(computed.statusCode, 400, computed.body);
    const attached = await attach(app, token(ATHLETE), roomId, { pacingEstimateId: "x", trigger: "sometimes" });
    assert.equal(attached.statusCode, 400, attached.body);
  });
});
