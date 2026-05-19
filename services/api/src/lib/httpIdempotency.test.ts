import assert from "node:assert/strict";
import test from "node:test";
import {
  clearHttpIdempotencyStoreForTests,
  hashHttpRequestBody,
  lookupIdempotentResponse,
  storeIdempotentResponse
} from "./httpIdempotency.js";

test("idempotency returns cached response for same key and body hash", () => {
  clearHttpIdempotencyStoreForTests();
  const key = "k1";
  const hash = hashHttpRequestBody({ a: 1 });
  storeIdempotentResponse(key, hash, 201, { id: "room-1" });
  const cached = lookupIdempotentResponse(key, hash);
  assert.deepEqual(cached, { statusCode: 201, body: { id: "room-1" } });
});

test("idempotency last-wins when body hash changes", () => {
  clearHttpIdempotencyStoreForTests();
  const key = "k2";
  const hashA = hashHttpRequestBody({ a: 1 });
  const hashB = hashHttpRequestBody({ a: 2 });
  storeIdempotentResponse(key, hashA, 201, { id: "first" });
  assert.equal(lookupIdempotentResponse(key, hashB), null);
  storeIdempotentResponse(key, hashB, 201, { id: "second" });
  assert.deepEqual(lookupIdempotentResponse(key, hashB)?.body, { id: "second" });
});
