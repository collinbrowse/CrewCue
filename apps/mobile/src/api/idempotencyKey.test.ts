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

test("hashIdempotencyPayload ignores object key order", async () => {
  const a = await hashIdempotencyPayload({ z: 1, a: { y: 2, b: 3 } });
  const b = await hashIdempotencyPayload({ a: { b: 3, y: 2 }, z: 1 });
  assert.equal(a, b);
});
