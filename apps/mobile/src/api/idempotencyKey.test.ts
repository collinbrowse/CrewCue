import assert from "node:assert/strict";
import test from "node:test";
import { hashIdempotencyPayload } from "./idempotencyKey.js";

test("hashIdempotencyPayload is stable for the same payload", async () => {
  const payload = { course: { checkpoints: [{ id: "a" }] }, pace: 360 };
  const a = await hashIdempotencyPayload(payload);
  const b = await hashIdempotencyPayload(payload);
  assert.equal(a, b);
  assert.equal(a.length, 16);
});

test("hashIdempotencyPayload changes when payload changes", async () => {
  const a = await hashIdempotencyPayload({ a: 1 });
  const b = await hashIdempotencyPayload({ a: 2 });
  assert.notEqual(a, b);
});
