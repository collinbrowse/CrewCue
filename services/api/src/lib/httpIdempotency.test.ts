import assert from "node:assert/strict";
import test from "node:test";
import {
  clearHttpIdempotencyStoreForTests,
  hashHttpRequestBody,
  lookupIdempotentResponse,
  resolveIdempotentRequest,
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

test("idempotency reports conflict when body hash changes for same key", async () => {
  clearHttpIdempotencyStoreForTests();
  const key = "k2";
  const hashA = hashHttpRequestBody({ a: 1 });
  const hashB = hashHttpRequestBody({ a: 2 });
  storeIdempotentResponse(key, hashA, 201, { id: "first" });

  const request = {
    headers: { "idempotency-key": key },
    method: "POST",
    url: "/race-rooms"
  };

  assert.deepEqual(await resolveIdempotentRequest(request as never, { a: 1 }), {
    kind: "hit",
    statusCode: 201,
    body: { id: "first" }
  });
  assert.deepEqual(await resolveIdempotentRequest(request as never, { a: 2 }), { kind: "conflict" });
  assert.equal(lookupIdempotentResponse(key, hashB), null);
});
