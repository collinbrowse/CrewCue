import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { canonicalJsonStringify } from "@crewcue/platform-client";
import { getPersistencePool, initRoomPersistence, isRoomPersistenceEnabled } from "./roomPersistence.js";
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

const testLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => testLog
} as unknown as FastifyBaseLogger;

async function resetIdempotencyStoreForTests(): Promise<void> {
  if (isRoomPersistenceEnabled()) {
    await initRoomPersistence(testLog);
    const pool = getPersistencePool();
    if (pool) {
      await pool.query("DELETE FROM http_idempotency");
    }
    return;
  }
  clearHttpIdempotencyStoreForTests();
}

test("hashHttpRequestBody is stable regardless of key order", () => {
  const a = hashHttpRequestBody({ z: 1, a: { y: 2, b: 3 } });
  const b = hashHttpRequestBody({ a: { b: 3, y: 2 }, z: 1 });
  assert.equal(a, b);
  assert.equal(canonicalJsonStringify({ a: 1, b: 2 }), canonicalJsonStringify({ b: 2, a: 1 }));
});

test("idempotency returns cached response for same key and body hash", async (t) => {
  if (isRoomPersistenceEnabled()) {
    t.skip("memory-store helper; covered by postgres idempotency tests");
    return;
  }
  await resetIdempotencyStoreForTests();
  const key = "k1";
  const hash = hashHttpRequestBody({ a: 1 });
  storeIdempotentResponse(key, hash, 201, { id: "room-1" });
  const cached = lookupIdempotentResponse(key, hash);
  assert.deepEqual(cached, { statusCode: 201, body: { id: "room-1" } });
});

test("idempotency reports conflict when body hash changes for same key", async (t) => {
  if (isRoomPersistenceEnabled()) {
    t.skip("memory-store helper; covered by postgres idempotency tests");
    return;
  }
  await resetIdempotencyStoreForTests();
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

test("memory idempotency scopes by method and path", async (t) => {
  if (isRoomPersistenceEnabled()) {
    t.skip("memory-store helper; covered by postgres idempotency tests");
    return;
  }
  await resetIdempotencyStoreForTests();
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

test("beginIdempotentMutation blocks concurrent duplicate body until complete", async (t) => {
  await resetIdempotencyStoreForTests();
  const request = {
    headers: { "idempotency-key": `busy-${isRoomPersistenceEnabled() ? Date.now() : "key"}` },
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

test("memory idempotency reclaims stale processing lease on retry", async (t) => {
  if (isRoomPersistenceEnabled()) {
    t.skip("memory-store lease; postgres lookup reclaims stale processing rows");
    return;
  }
  await resetIdempotencyStoreForTests();
  let now = 1_700_000_000_000;
  t.mock.method(Date, "now", () => now);
  const request = {
    headers: { "idempotency-key": "stale-processing" },
    method: "POST",
    url: "/race-rooms"
  };
  const body = { a: 1 };

  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "proceed");
  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "in_progress");

  now += 5 * 60 * 1000 + 1;

  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "proceed");
  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "in_progress");
});

test("postgres idempotency reclaims stale processing lease on retry", async (t) => {
  if (!isRoomPersistenceEnabled()) {
    t.skip("requires PERSISTENCE_MODE=postgres");
    return;
  }
  await resetIdempotencyStoreForTests();
  const pool = getPersistencePool();
  assert.ok(pool);
  const key = `pg-stale-${Date.now()}`;
  const body = { a: 1 };
  const request = {
    headers: { "idempotency-key": key },
    method: "POST",
    url: "/race-rooms"
  };
  await pool.query(
    `INSERT INTO http_idempotency
       (idempotency_key, method, path, request_hash, status_code, response_body, created_at, expires_at, state)
     VALUES ($1, 'POST', '/race-rooms', $2, 0, '{}'::jsonb, NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '1 hour', 'processing')`,
    [key, hashHttpRequestBody(body)]
  );

  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "proceed");
  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "in_progress");
});

test("releaseIdempotentMutation allows retry after failed mutation", async () => {
  await resetIdempotencyStoreForTests();
  const request = {
    headers: { "idempotency-key": `release-${isRoomPersistenceEnabled() ? Date.now() : "key"}` },
    method: "POST",
    url: "/race-rooms"
  };
  const body = { a: 1 };

  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "proceed");
  await releaseIdempotentMutation(request as never, body);
  assert.equal((await beginIdempotentMutation(request as never, body)).kind, "proceed");
});

test("purgeExpiredHttpIdempotencyRecords removes expired memory rows", async (t) => {
  if (isRoomPersistenceEnabled()) {
    t.skip("memory-store expiry; postgres purge covered by integration routes");
    return;
  }
  await resetIdempotencyStoreForTests();
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
  await resetIdempotencyStoreForTests();
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

test("postgres idempotency reports conflict when body hash changes", async (t) => {
  if (!isRoomPersistenceEnabled()) {
    t.skip("requires PERSISTENCE_MODE=postgres");
    return;
  }
  await resetIdempotencyStoreForTests();
  const key = `pg-conflict-${Date.now()}`;
  const request = {
    headers: { "idempotency-key": key },
    method: "POST",
    url: "/race-rooms"
  };

  assert.equal((await beginIdempotentMutation(request as never, { a: 1 })).kind, "proceed");
  await completeIdempotentMutation(request as never, { a: 1 }, 201, { id: "first" });

  assert.deepEqual(await resolveIdempotentRequest(request as never, { a: 1 }), {
    kind: "hit",
    statusCode: 201,
    body: { id: "first" }
  });
  assert.deepEqual(await resolveIdempotentRequest(request as never, { a: 2 }), { kind: "conflict" });
});

test("postgres idempotency scopes by method and path", async (t) => {
  if (!isRoomPersistenceEnabled()) {
    t.skip("requires PERSISTENCE_MODE=postgres");
    return;
  }
  await resetIdempotencyStoreForTests();
  const key = `pg-scope-${Date.now()}`;
  const body = { a: 1 };
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

  assert.equal((await beginIdempotentMutation(createReq as never, body)).kind, "proceed");
  await completeIdempotentMutation(createReq as never, body, 201, { id: "room" });
  assert.equal((await beginIdempotentMutation(courseReq as never, body)).kind, "proceed");
  await completeIdempotentMutation(courseReq as never, body, 200, { id: "course" });

  assert.deepEqual(await resolveIdempotentRequest(createReq as never, body), {
    kind: "hit",
    statusCode: 201,
    body: { id: "room" }
  });
  assert.deepEqual(await resolveIdempotentRequest(courseReq as never, body), {
    kind: "hit",
    statusCode: 200,
    body: { id: "course" }
  });
});
