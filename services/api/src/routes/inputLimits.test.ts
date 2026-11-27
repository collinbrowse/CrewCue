import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { DEFAULT_BODY_LIMIT_BYTES, GPX_JSON_BODY_LIMIT_BYTES } from "../lib/bodyLimits.js";
import { MAX_GPX_XML_CHARS } from "../lib/gpxLimits.js";
import {
  JOIN_CODE_FAILURE_BUDGET,
  joinCodeBudgetRetryAfterSeconds,
  recordJoinCodeFailure,
  resetJoinCodeBudgetForTests
} from "../lib/joinCodeBudget.js";
import { ROOM_INPUT_LIMITS } from "./raceRooms.js";

type App = ReturnType<typeof buildApp>;

function tokenFor(app: App, sub: string): string {
  return app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} });
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

async function createRoom(app: App, token: string, body: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/race-rooms",
    headers: { authorization: `Bearer ${token}` },
    payload: { teamId: "team-1", athleteId: "athlete-1", name: "Limits Race", ...body }
  });
}

test("room text fields have length limits", async () => {
  await withApp(async (app) => {
    const token = tokenFor(app, `limits-owner-${randomUUID()}`);
    const tooLong = (chars: number) => "x".repeat(chars + 1);
    for (const body of [
      { name: tooLong(ROOM_INPUT_LIMITS.roomNameChars) },
      { teamId: tooLong(ROOM_INPUT_LIMITS.idChars) },
      { description: tooLong(ROOM_INPUT_LIMITS.descriptionChars) },
      { crewName: tooLong(ROOM_INPUT_LIMITS.personNameChars) },
      { creatorName: tooLong(ROOM_INPUT_LIMITS.personNameChars) }
    ]) {
      const response = await createRoom(app, token, body);
      assert.equal(response.statusCode, 400, Object.keys(body)[0]);
    }
    const atLimit = await createRoom(app, token, {
      name: "x".repeat(ROOM_INPUT_LIMITS.roomNameChars),
      description: "d".repeat(ROOM_INPUT_LIMITS.descriptionChars),
      crewName: "c".repeat(ROOM_INPUT_LIMITS.personNameChars)
    });
    assert.equal(atLimit.statusCode, 201);
  });
});

test("course and map workspace lists have length caps", async () => {
  await withApp(async (app) => {
    const token = tokenFor(app, `limits-course-${randomUUID()}`);
    const created = await createRoom(app, token);
    assert.equal(created.statusCode, 201);
    const roomId = (created.json() as { id: string }).id;
    // The map workspace needs a paid race. Same grant path as a store purchase.
    const paid = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/billing/dev-purchase`,
      payload: { productId: "race_pass" },
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(paid.statusCode, 200);
    const checkpoints = Array.from({ length: ROOM_INPUT_LIMITS.checkpoints + 1 }, (_, i) => ({
      id: `cp-${i}`,
      latitude: 39 + i / 10_000,
      longitude: -120
    }));
    const course = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/course`,
      headers: { authorization: `Bearer ${token}` },
      payload: { course: { checkpoints }, plannedPaceSecondsPerKm: 400, raceStartAt: new Date().toISOString() }
    });
    assert.equal(course.statusCode, 400);

    const workspace = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/map-workspace`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        layers: [
          {
            id: "route",
            label: "Route",
            visible: true,
            geometry: {
              type: "LineString",
              coordinates: Array.from({ length: ROOM_INPUT_LIMITS.routeLineVertices + 1 }, (_, i) => [-120, 39 + i / 1e6])
            }
          }
        ],
        checkpoints: []
      }
    });
    assert.equal(workspace.statusCode, 400);
  });
});

test("bodies over 1 MB are refused unless the route takes files", async () => {
  await withApp(async (app) => {
    const token = tokenFor(app, `limits-body-${randomUUID()}`);
    const big = await createRoom(app, token, { name: "x".repeat(DEFAULT_BODY_LIMIT_BYTES) });
    assert.equal(big.statusCode, 413);
    assert.deepEqual(big.json(), { error: "Request body is too large", code: "body_too_large" });

    // A course with its GPX text is larger than 1 MB and still reaches the handler.
    const created = await createRoom(app, token);
    const roomId = (created.json() as { id: string }).id;
    const course = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/course`,
      headers: { authorization: `Bearer ${token}` },
      payload: { courseGpxXml: "g".repeat(2 * DEFAULT_BODY_LIMIT_BYTES) }
    });
    assert.notEqual(course.statusCode, 413);

    // Over the GPX cap: refused with the file route's message.
    const gpx = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: JSON.stringify({ gpxXml: "g".repeat(GPX_JSON_BODY_LIMIT_BYTES) })
    });
    assert.equal(gpx.statusCode, 413);
    assert.equal(gpx.json().code, "file_too_large");

    // Other errors keep Fastify's default body.
    const badJson = await app.inject({
      method: "POST",
      url: "/race-rooms",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: "{"
    });
    assert.equal(badJson.statusCode, 400);
    assert.equal(badJson.json().statusCode, 400);
  });
});

test("routes that take files refuse a missing token before reading the body", async () => {
  await withApp(async (app) => {
    for (const [method, url] of [
      ["POST", "/race-rooms/room-1/course/gpx-preview"],
      ["PUT", "/race-rooms/room-1/course"],
      ["PUT", "/race-rooms/room-1/map-workspace"],
      ["POST", "/activity-history/gpx"],
      ["POST", "/activity-history/file"],
      ["POST", "/activity-history/preview"],
      ["POST", "/activity-history/archive"]
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ gpxXml: "g".repeat(MAX_GPX_XML_CHARS) })
      });
      assert.equal(response.statusCode, 401, url);
      assert.deepEqual(response.json(), { error: "Unauthorized" });

      // A token that fails verification is still refused, by the handler after parsing.
      const badToken = await app.inject({
        method,
        url,
        headers: { authorization: "Bearer not-a-real-jwt", "content-type": "application/json" },
        payload: JSON.stringify({})
      });
      assert.equal(badToken.statusCode, 401, url);
    }
  });
});

test("room code failures share one budget per account (per address when signed out)", async () => {
  await withApp(async (app) => {
    await resetJoinCodeBudgetForTests();
    const now = Date.now();
    const subject = `budget-${randomUUID()}`;
    for (let i = 0; i < JOIN_CODE_FAILURE_BUDGET.perSubject - 1; i += 1) {
      await recordJoinCodeFailure(subject, now);
    }
    assert.equal(await joinCodeBudgetRetryAfterSeconds(subject, now), null);
    await recordJoinCodeFailure(subject, now);
    const retryAfter = await joinCodeBudgetRetryAfterSeconds(subject, now);
    assert.ok(retryAfter !== null && retryAfter >= 1 && retryAfter <= 3600);
    // Other accounts keep their own budget.
    assert.equal(await joinCodeBudgetRetryAfterSeconds(`other-${randomUUID()}`, now), null);
    // The next window starts fresh.
    assert.equal(await joinCodeBudgetRetryAfterSeconds(subject, now + JOIN_CODE_FAILURE_BUDGET.windowMs), null);

    await resetJoinCodeBudgetForTests();

    // Unknown codes count; the route answers 404 until the account's budget is spent, then 429
    // before the code is looked up. Another account still gets 404.
    const crew = `counted-${randomUUID()}`;
    const join = (sub: string) =>
      app.inject({
        method: "POST",
        url: "/race-rooms/join-by-code",
        headers: { authorization: `Bearer ${tokenFor(app, sub)}` },
        payload: { roomCode: "000000" }
      });
    assert.equal((await join(crew)).statusCode, 404);
    for (let i = 1; i < JOIN_CODE_FAILURE_BUDGET.perSubject; i += 1) await recordJoinCodeFailure(crew);
    const refused = await join(crew);
    assert.equal(refused.statusCode, 429);
    assert.ok(Number(refused.headers["retry-after"]) >= 1);
    assert.equal((await join(`fresh-${randomUUID()}`)).statusCode, 404);

    // Signed-out previews count against the client address.
    const preview = () => app.inject({ method: "GET", url: "/race-rooms/join-preview/000000" });
    assert.equal((await preview()).statusCode, 404);
    for (let i = 1; i < JOIN_CODE_FAILURE_BUDGET.perSubject; i += 1) await recordJoinCodeFailure("ip:127.0.0.1");
    assert.equal((await preview()).statusCode, 429);
    await resetJoinCodeBudgetForTests();
  });
});
