import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJsonStringify } from "@crewcue/platform-client";
import { isRoomPersistenceEnabled } from "./roomPersistence.js";
import {
  beginIdempotentMutation,
  clearHttpIdempotencyStoreForTests,
  completeIdempotentMutation,
  expireIdempotencyRecordForTests,
  hashHttpRequestBody,
  idempotencyScopeKey,
  lookupIdempotentResponse,
  purgeExpiredHttpIdempotencyRecords,
  releaseIdempotentMutation,
  resolveIdempotentRequest,
  storeIdempotentResponse
} from "./httpIdempotency.js";

test("hashHttpRequestBody is stable regardless of key order", () => {
  const a = hashHttpRequestBody({ z: 1, a: { y: 2, b: 3 } });
  const b = hashHttpRequestBody({ a: { b: 3, y: 2 }, z: 1 });
  assert.equal(a, b);
  assert.equal(canonicalJsonStringify({ a: 1, b: 2 }), canonicalJsonStringify({ b: 2, a: 1 }));
});

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

test("beginIdempotentMutation blocks concurrent duplicate body until complete", async () => {
  clearHttpIdempotencyStoreForTests();
  const request = {
    headers: { "idempotency-key": "busy-key" },
    method: "POST",
    url: "/race-rooms"
  };
  const body = { a: 1 };

  const first = await beginIdempotentMutation(request as never, body);
  assert.equal(first.kind, "proceed");

  const second = await beginIdempotentMutation(request as never, body);
  assert.equal(second.kind, "in_progress");

  await completeIdempotentMutation(request as never, body, 201, { id: "room-1" });

  const third = await beginIdempotentMutation(request as never, body);
  assert.equal(third.kind, "replay");
  if (third.kind === "replay") {
    assert.deepEqual(third.body, { id: "room-1" });
  }
});

test("releaseIdempotentMutation allows retry after failed mutation", async () => {
  clearHttpIdempotencyStoreForTests();
  const request = {
    headers: { "idempotency-key": "release-key" },
    method: "POST",
    url: "/race-rooms"
  };
  const body = { a: 1 };

  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "proceed");
  await releaseIdempotentMutation(request as never, body);
  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "proceed");
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

test("postgres idempotency claim completes and replays", async (t) => {
  if (!isRoomPersistenceEnabled()) {
    t.skip("requires PERSISTENCE_MODE=postgres");
    return;
  }
  clearHttpIdempotencyStoreForTests();
  const request = {
    headers: { "idempotency-key": `pg-${Date.now()}` },
    method: "PUT",
    url: "/race-rooms/pg-room/course"
  };
  const body = { course: { checkpoints: [] } };

  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "proceed");
  await completeIdempotentMutation(request as never, body, 200, { id: "pg-room", course: body.course });
  const replay = await beginIdempotentMutation(request as never, body);
  assert.equal(replay.kind, "replay");
  if (replay.kind === "replay") {
    assert.equal(replay.statusCode, 200);
  }
});
