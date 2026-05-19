import assert from "node:assert/strict";
import test from "node:test";
import {
  clearHttpIdempotencyStoreForTests,
  expireIdempotencyRecordForTests,
  hashHttpRequestBody,
  idempotencyScopeKey,
  lookupIdempotentResponse,
  purgeExpiredHttpIdempotencyRecords,
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

test("memory idempotency scopes by method and path", async () => {
  clearHttpIdempotencyStoreForTests();
  const key = "shared-key";
  const hash = hashHttpRequestBody({ a: 1 });
  storeIdempotentResponse(key, hash, 201, { id: "room" }, "POST", "/race-rooms");
  storeIdempotentResponse(key, hash, 200, { id: "course" }, "PUT", "/race-rooms/r1/course");

  const createReq = {
    headers: { "idempotency-key": key },
    method: "POST",
    url: "/race-rooms"
  };
  const courseReq = {
    headers: { "idempotency-key": key },
    method: "PUT",
    url: "/race-rooms/r1/course"
  };

  assert.deepEqual(await resolveIdempotentRequest(createReq as never, { a: 1 }), {
    kind: "hit",
    statusCode: 201,
    body: { id: "room" }
  });
  assert.deepEqual(await resolveIdempotentRequest(courseReq as never, { a: 1 }), {
    kind: "hit",
    statusCode: 200,
    body: { id: "course" }
  });
  assert.equal(idempotencyScopeKey(key, "POST", "/race-rooms").includes("\0"), true);
});

test("purgeExpiredHttpIdempotencyRecords removes expired memory rows", async () => {
  clearHttpIdempotencyStoreForTests();
  const key = "expired";
  const hash = hashHttpRequestBody({ x: 1 });
  storeIdempotentResponse(key, hash, 201, { id: "old" });
  expireIdempotencyRecordForTests(key, "POST", "/race-rooms");
  const removed = await purgeExpiredHttpIdempotencyRecords();
  assert.equal(removed, 1);
  assert.equal(lookupIdempotentResponse(key, hash), null);
});
