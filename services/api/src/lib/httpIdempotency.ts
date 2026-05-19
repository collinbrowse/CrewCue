import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { canonicalJsonStringify } from "@crewcue/platform-client";
import { getPersistencePool, isRoomPersistenceEnabled } from "./roomPersistence.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const PROCESSING_LEASE_MS = 5 * 60 * 1000;
const PURGE_INTERVAL_MS = 5 * 60 * 1000;

type IdempotencyState = "processing" | "complete";

type StoredIdempotentRecord = {
  requestHash: string;
  statusCode: number;
  bodyJson: string;
  expiresAtMs: number;
  createdAtMs: number;
  state: IdempotencyState;
};

const memoryStore = new Map<string, StoredIdempotentRecord>();
let lastPurgeAtMs = 0;

export type IdempotencyLookupResult =
  | { kind: "hit"; statusCode: number; body: unknown }
  | { kind: "conflict" }
  | { kind: "in_progress" }
  | { kind: "miss" };

export type IdempotencyBeginResult =
  | { kind: "replay"; statusCode: number; body: unknown }
  | { kind: "conflict" }
  | { kind: "in_progress" }
  | { kind: "proceed" };

export function hashHttpRequestBody(body: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(body)).digest("hex");
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
  if (row.state === "processing") {
    if (row.createdAtMs <= Date.now() - PROCESSING_LEASE_MS) {
      memoryStore.delete(scopeKey);
      return { kind: "miss" };
    }
    return { kind: "in_progress" };
  }
  return { kind: "hit", statusCode: row.statusCode, body: JSON.parse(row.bodyJson) as unknown };
}

function claimMemory(scopeKey: string, requestHash: string): IdempotencyBeginResult {
  const existing = memoryStore.get(scopeKey);
  if (existing && existing.expiresAtMs > Date.now()) {
    if (existing.requestHash !== requestHash) {
      return { kind: "conflict" };
    }
    if (existing.state === "processing") {
      return { kind: "in_progress" };
    }
    return {
      kind: "replay",
      statusCode: existing.statusCode,
      body: JSON.parse(existing.bodyJson) as unknown
    };
  }
  const now = Date.now();
  memoryStore.set(scopeKey, {
    requestHash,
    statusCode: 0,
    bodyJson: "{}",
    expiresAtMs: now + TTL_MS,
    createdAtMs: now,
    state: "processing"
  });
  return { kind: "proceed" };
}

function completeMemory(scopeKey: string, requestHash: string, statusCode: number, body: unknown): void {
  const now = Date.now();
  memoryStore.set(scopeKey, {
    requestHash,
    statusCode,
    bodyJson: JSON.stringify(body ?? null),
    expiresAtMs: now + TTL_MS,
    createdAtMs: now,
    state: "complete"
  });
}

function releaseMemory(scopeKey: string, requestHash: string): void {
  const row = memoryStore.get(scopeKey);
  if (row && row.state === "processing" && row.requestHash === requestHash) {
    memoryStore.delete(scopeKey);
  }
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
    created_at: Date;
    state: IdempotencyState;
  }>(
    `SELECT request_hash, status_code, response_body, expires_at, created_at, state
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
  if (row.state === "processing") {
    if (row.created_at.getTime() <= Date.now() - PROCESSING_LEASE_MS) {
      await pool.query(
        `DELETE FROM http_idempotency WHERE idempotency_key = $1 AND method = $2 AND path = $3`,
        [idempotencyKey, method, path]
      );
      return { kind: "miss" };
    }
    return { kind: "in_progress" };
  }
  return { kind: "hit", statusCode: row.status_code, body: row.response_body };
}

async function claimPostgres(
  idempotencyKey: string,
  method: string,
  path: string,
  requestHash: string,
  attempt = 0
): Promise<IdempotencyBeginResult> {
  const pool = getPersistencePool();
  if (!pool) {
    return { kind: "proceed" };
  }

  const resolved = await lookupPostgres(idempotencyKey, method, path, requestHash);
  if (resolved.kind === "hit") {
    return { kind: "replay", statusCode: resolved.statusCode, body: resolved.body };
  }
  if (resolved.kind === "in_progress") {
    return { kind: "in_progress" };
  }
  if (resolved.kind === "conflict") {
    return { kind: "conflict" };
  }

  const expiresAt = new Date(Date.now() + TTL_MS);
  try {
    await pool.query(
      `INSERT INTO http_idempotency (idempotency_key, method, path, request_hash, status_code, response_body, expires_at, state)
       VALUES ($1, $2, $3, $4, 0, '{}'::jsonb, $5, 'processing')`,
      [idempotencyKey, method, path, requestHash, expiresAt]
    );
    return { kind: "proceed" };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : undefined;
    if (code === "23505" && attempt < 2) {
      return claimPostgres(idempotencyKey, method, path, requestHash, attempt + 1);
    }
    throw err;
  }
}

async function completePostgres(
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
    `INSERT INTO http_idempotency (idempotency_key, method, path, request_hash, status_code, response_body, expires_at, state)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'complete')
     ON CONFLICT (idempotency_key, method, path) DO UPDATE SET
       request_hash = EXCLUDED.request_hash,
       status_code = EXCLUDED.status_code,
       response_body = EXCLUDED.response_body,
       expires_at = EXCLUDED.expires_at,
       state = 'complete'`,
    [idempotencyKey, method, path, requestHash, statusCode, body ?? null, expiresAt]
  );
}

async function releasePostgres(idempotencyKey: string, method: string, path: string, requestHash: string): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    return;
  }
  await pool.query(
    `DELETE FROM http_idempotency
     WHERE idempotency_key = $1 AND method = $2 AND path = $3 AND request_hash = $4 AND state = 'processing'`,
    [idempotencyKey, method, path, requestHash]
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

function readIdempotencyScope(request: FastifyRequest, bodyForHash: unknown): {
  key?: string;
  method: string;
  path: string;
  requestHash: string;
  scopeKey?: string;
} {
  const key = readIdempotencyKey(request);
  const method = request.method;
  const path = readRequestPath(request);
  const requestHash = hashHttpRequestBody(bodyForHash);
  return {
    key,
    method,
    path,
    requestHash,
    scopeKey: key ? idempotencyScopeKey(key, method, path) : undefined
  };
}

export async function resolveIdempotentRequest(
  request: FastifyRequest,
  bodyForHash: unknown
): Promise<IdempotencyLookupResult> {
  await purgeExpiredHttpIdempotencyIfDue();
  const { key, method, path, requestHash, scopeKey } = readIdempotencyScope(request, bodyForHash);
  if (!key || !scopeKey) {
    return { kind: "miss" };
  }
  if (isRoomPersistenceEnabled()) {
    return lookupPostgres(key, method, path, requestHash);
  }
  return lookupMemory(scopeKey, requestHash);
}

/** Claim an idempotency slot before mutation; replays completed work or rejects conflicts. */
export async function beginIdempotentMutation(
  request: FastifyRequest,
  bodyForHash: unknown
): Promise<IdempotencyBeginResult> {
  await purgeExpiredHttpIdempotencyIfDue();
  const { key, method, path, requestHash, scopeKey } = readIdempotencyScope(request, bodyForHash);
  if (!key || !scopeKey) {
    return { kind: "proceed" };
  }
  if (isRoomPersistenceEnabled()) {
    return claimPostgres(key, method, path, requestHash);
  }
  return claimMemory(scopeKey, requestHash);
}

export async function completeIdempotentMutation(
  request: FastifyRequest,
  bodyForHash: unknown,
  statusCode: number,
  body: unknown
): Promise<void> {
  const { key, method, path, requestHash, scopeKey } = readIdempotencyScope(request, bodyForHash);
  if (!key || !scopeKey) {
    return;
  }
  if (isRoomPersistenceEnabled()) {
    await completePostgres(key, method, path, requestHash, statusCode, body);
    return;
  }
  completeMemory(scopeKey, requestHash, statusCode, body);
}

export async function releaseIdempotentMutation(request: FastifyRequest, bodyForHash: unknown): Promise<void> {
  const { key, method, path, requestHash, scopeKey } = readIdempotencyScope(request, bodyForHash);
  if (!key || !scopeKey) {
    return;
  }
  if (isRoomPersistenceEnabled()) {
    await releasePostgres(key, method, path, requestHash);
    return;
  }
  releaseMemory(scopeKey, requestHash);
}

function idempotencyErrorReply(reply: FastifyReply, resolved: { kind: "conflict" } | { kind: "in_progress" }): FastifyReply {
  if (resolved.kind === "conflict") {
    return reply.code(409).send({ error: "Idempotency-Key was already used with a different request body" });
  }
  return reply.code(409).send({ error: "A request with this Idempotency-Key is already in progress" });
}

/** @deprecated Prefer beginIdempotentMutation — replay-only helper for tests. */
export async function tryReplayIdempotentResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  bodyForHash: unknown
): Promise<FastifyReply | null> {
  const resolved = await resolveIdempotentRequest(request, bodyForHash);
  if (resolved.kind === "conflict" || resolved.kind === "in_progress") {
    return idempotencyErrorReply(reply, resolved);
  }
  if (resolved.kind === "hit") {
    return reply.code(resolved.statusCode).send(resolved.body);
  }
  return null;
}

/** @deprecated Prefer beginIdempotentMutation + completeIdempotentMutation. */
export async function persistIdempotentResponse(
  request: FastifyRequest,
  bodyForHash: unknown,
  statusCode: number,
  body: unknown
): Promise<void> {
  await completeIdempotentMutation(request, bodyForHash, statusCode, body);
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

/** @deprecated Use completeIdempotentMutation — kept for unit tests. */
export function storeIdempotentResponse(
  key: string,
  requestHash: string,
  statusCode: number,
  body: unknown,
  method = "POST",
  path = "/race-rooms"
): void {
  completeMemory(idempotencyScopeKey(key, method, path), requestHash, statusCode, body);
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

export { idempotencyErrorReply };
