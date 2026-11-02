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
