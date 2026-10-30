import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";

test("the retired unscoped /events route is not served", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign({ sub: "user-1", teamIds: ["team-1"], roomRoles: {} });
  const res = await app.inject({
    method: "POST",
    url: "/events",
    headers: { authorization: `Bearer ${token}` },
    payload: { aggregateId: "a", aggregateType: "race_room", eventType: "x", idempotencyKey: "k", payload: {} }
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});
