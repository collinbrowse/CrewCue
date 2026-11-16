import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";

test("repeated GPX preview requests from one user are throttled, other users are not", async () => {
  const app = buildApp();
  await app.ready();
  const tokenFor = (sub: string) => app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} });
  const call = (sub: string) =>
    app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
      payload: {}
    });

  for (let i = 0; i < 10; i += 1) {
    assert.notEqual((await call("user-a")).statusCode, 429);
  }
  const limited = await call("user-a");
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers["retry-after"]) >= 1);
  assert.notEqual((await call("user-b")).statusCode, 429);
  await app.close();
});

test("routes outside the limited set are not throttled", async () => {
  const app = buildApp();
  await app.ready();
  for (let i = 0; i < 50; i += 1) {
    const res = await app.inject({ method: "GET", url: "/health/live" });
    assert.equal(res.statusCode, 200);
  }
  await app.close();
});

test("repeated room code attempts are throttled per user and per client address", async () => {
  const app = buildApp();
  await app.ready();
  const tokenFor = (sub: string) => app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} });
  const call = (sub: string) =>
    app.inject({
      method: "POST",
      url: "/race-rooms/join-by-code",
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
      payload: { roomCode: "000000" }
    });

  for (let i = 0; i < 10; i += 1) {
    assert.equal((await call("user-a")).statusCode, 404);
  }
  const limited = await call("user-a");
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers["retry-after"]) >= 1);

  // Fresh accounts from the same address share one budget (10 used above + 20 more).
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await call(`fresh-${i}`)).statusCode, 404);
  }
  assert.equal((await call("fresh-final")).statusCode, 429);
  await app.close();
});

test("pacing estimates: computing and attaching are each capped at 20 an hour per user", async () => {
  const app = buildApp();
  await app.ready();
  const tokenFor = (sub: string) => app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} });
  const compute = (sub: string) =>
    app.inject({
      method: "POST",
      url: "/pacing-estimates",
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
      payload: {}
    });
  // Different rooms share one budget: the limit is per user, not per race.
  const attach = (sub: string, i: number) =>
    app.inject({
      method: "PUT",
      url: `/race-rooms/room-${i}/pacing-estimate`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
      payload: { pacingEstimateId: "est-1" }
    });

  for (let i = 0; i < 20; i += 1) {
    assert.equal((await compute("user-a")).statusCode, 400);
    assert.equal((await attach("user-a", i)).statusCode, 404);
  }
  const computeLimited = await compute("user-a");
  assert.equal(computeLimited.statusCode, 429);
  // About an hour, not a minute.
  assert.ok(Number(computeLimited.headers["retry-after"]) > 60 * 59);
  assert.equal((await attach("user-a", 20)).statusCode, 429);
  assert.equal((await compute("user-b")).statusCode, 400);
  assert.equal((await attach("user-b", 0)).statusCode, 404);
  await app.close();
});
