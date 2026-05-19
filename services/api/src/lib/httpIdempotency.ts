import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getPersistencePool, isRoomPersistenceEnabled } from "./roomPersistence.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 5 * 60 * 1000;

type StoredIdempotentResponse = {
  requestHash: string;
  statusCode: number;
  bodyJson: string;
  expiresAtMs: number;
};

const memoryStore = new Map<string, StoredIdempotentResponse>();
let lastPurgeAtMs = 0;

export type IdempotencyLookupResult =
  | { kind: "hit"; statusCode: number; body: unknown }
  | { kind: "conflict" }
  | { kind: "miss" };

export function hashHttpRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export function readIdempotencyKey(request: FastifyRequest): string | undefined {
  const raw = request.headers["idempotency-key"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return undefined;
}

export function readRequestPath(request: FastifyRequest): string {
  const url = request.url ?? "";
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

export function idempotencyScopeKey(idempotencyKey: string, method: string, path: string): string {
  return `${method}\0${path}\0${idempotencyKey}`;
}

function lookupMemory(scopeKey: string, requestHash: string): IdempotencyLookupResult {
  const row = memoryStore.get(scopeKey);
  if (!row || row.expiresAtMs <= Date.now()) {
    memoryStore.delete(scopeKey);
    return { kind: "miss" };
  }
  if (row.requestHash !== requestHash) {
    return { kind: "conflict" };
  }
  return { kind: "hit", statusCode: row.statusCode, body: JSON.parse(row.bodyJson) as unknown };
}

function storeMemory(scopeKey: string, requestHash: string, statusCode: number, body: unknown): void {
  memoryStore.set(scopeKey, {
    requestHash,
    statusCode,
    bodyJson: JSON.stringify(body ?? null),
    expiresAtMs: Date.now() + TTL_MS
  });
}

async function lookupPostgres(
  idempotencyKey: string,
  method: string,
  path: string,
  requestHash: string
): Promise<IdempotencyLookupResult> {
  const pool = getPersistencePool();
  if (!pool) {
    return { kind: "miss" };
  }
  const result = await pool.query<{
    request_hash: string;
    status_code: number;
    response_body: unknown;
    expires_at: Date;
  }>(
    `SELECT request_hash, status_code, response_body, expires_at
     FROM http_idempotency
     WHERE idempotency_key = $1 AND method = $2 AND path = $3`,
    [idempotencyKey, method, path]
  );
  const row = result.rows[0];
  if (!row) {
    return { kind: "miss" };
  }
  if (row.expires_at.getTime() <= Date.now()) {
    await pool.query(
      `DELETE FROM http_idempotency WHERE idempotency_key = $1 AND method = $2 AND path = $3`,
      [idempotencyKey, method, path]
    );
    return { kind: "miss" };
  }
  if (row.request_hash !== requestHash) {
    return { kind: "conflict" };
  }
  return { kind: "hit", statusCode: row.status_code, body: row.response_body };
}

async function storePostgres(
  idempotencyKey: string,
  method: string,
  path: string,
  requestHash: string,
  statusCode: number,
  body: unknown
): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    return;
  }
  const expiresAt = new Date(Date.now() + TTL_MS);
  await pool.query(
    `INSERT INTO http_idempotency (idempotency_key, method, path, request_hash, status_code, response_body, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (idempotency_key, method, path) DO UPDATE SET
       request_hash = EXCLUDED.request_hash,
       status_code = EXCLUDED.status_code,
       response_body = EXCLUDED.response_body,
       expires_at = EXCLUDED.expires_at`,
    [idempotencyKey, method, path, requestHash, statusCode, body ?? null, expiresAt]
  );
}

export async function purgeExpiredHttpIdempotencyRecords(): Promise<number> {
  if (isRoomPersistenceEnabled()) {
    const pool = getPersistencePool();
    if (!pool) {
      return 0;
    }
    const result = await pool.query(`DELETE FROM http_idempotency WHERE expires_at < NOW()`);
    return result.rowCount ?? 0;
  }
  let removed = 0;
  const now = Date.now();
  for (const [scopeKey, row] of memoryStore.entries()) {
    if (row.expiresAtMs <= now) {
      memoryStore.delete(scopeKey);
      removed += 1;
    }
  }
  return removed;
}

async function purgeExpiredHttpIdempotencyIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastPurgeAtMs < PURGE_INTERVAL_MS) {
    return;
  }
  lastPurgeAtMs = now;
  await purgeExpiredHttpIdempotencyRecords();
}

export async function resolveIdempotentRequest(
  request: FastifyRequest,
  bodyForHash: unknown
): Promise<IdempotencyLookupResult> {
  await purgeExpiredHttpIdempotencyIfDue();
  const key = readIdempotencyKey(request);
  if (!key) {
    return { kind: "miss" };
  }
  const method = request.method;
  const path = readRequestPath(request);
  const requestHash = hashHttpRequestBody(bodyForHash);
  if (isRoomPersistenceEnabled()) {
    return lookupPostgres(key, method, path, requestHash);
  }
  return lookupMemory(idempotencyScopeKey(key, method, path), requestHash);
}

export async function tryReplayIdempotentResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  bodyForHash: unknown
): Promise<FastifyReply | null> {
  const resolved = await resolveIdempotentRequest(request, bodyForHash);
  if (resolved.kind === "conflict") {
    return reply.code(409).send({ error: "Idempotency-Key was already used with a different request body" });
  }
  if (resolved.kind === "hit") {
    return reply.code(resolved.statusCode).send(resolved.body);
  }
  return null;
}

export async function persistIdempotentResponse(
  request: FastifyRequest,
  bodyForHash: unknown,
  statusCode: number,
  body: unknown
): Promise<void> {
  const key = readIdempotencyKey(request);
  if (!key) {
    return;
  }
  const requestHash = hashHttpRequestBody(bodyForHash);
  const method = request.method;
  const path = readRequestPath(request);
  if (isRoomPersistenceEnabled()) {
    await storePostgres(key, method, path, requestHash, statusCode, body);
    return;
  }
  storeMemory(idempotencyScopeKey(key, method, path), requestHash, statusCode, body);
}

/** @deprecated Use resolveIdempotentRequest — kept for unit tests. */
export function lookupIdempotentResponse(
  key: string,
  requestHash: string,
  method = "POST",
  path = "/race-rooms"
): { statusCode: number; body: unknown } | null {
  const resolved = lookupMemory(idempotencyScopeKey(key, method, path), requestHash);
  if (resolved.kind === "hit") {
    return { statusCode: resolved.statusCode, body: resolved.body };
  }
  return null;
}

/** @deprecated Use persistIdempotentResponse — kept for unit tests. */
export function storeIdempotentResponse(
  key: string,
  requestHash: string,
  statusCode: number,
  body: unknown,
  method = "POST",
  path = "/race-rooms"
): void {
  storeMemory(idempotencyScopeKey(key, method, path), requestHash, statusCode, body);
}

export function expireIdempotencyRecordForTests(
  idempotencyKey: string,
  method: string,
  path: string
): void {
  const row = memoryStore.get(idempotencyScopeKey(idempotencyKey, method, path));
  if (row) {
    row.expiresAtMs = Date.now() - 1;
  }
}

export function clearHttpIdempotencyStoreForTests(): void {
  memoryStore.clear();
  lastPurgeAtMs = 0;
}
