import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getPersistencePool, isRoomPersistenceEnabled } from "./roomPersistence.js";

const TTL_MS = 24 * 60 * 60 * 1000;

type StoredIdempotentResponse = {
  requestHash: string;
  statusCode: number;
  bodyJson: string;
  expiresAtMs: number;
};

const memoryStore = new Map<string, StoredIdempotentResponse>();

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

function readRequestPath(request: FastifyRequest): string {
  const url = request.url ?? "";
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

function lookupMemory(key: string, requestHash: string): IdempotencyLookupResult {
  const row = memoryStore.get(key);
  if (!row || row.expiresAtMs <= Date.now()) {
    memoryStore.delete(key);
    return { kind: "miss" };
  }
  if (row.requestHash !== requestHash) {
    return { kind: "conflict" };
  }
  return { kind: "hit", statusCode: row.statusCode, body: JSON.parse(row.bodyJson) as unknown };
}

function storeMemory(key: string, requestHash: string, statusCode: number, body: unknown): void {
  memoryStore.set(key, {
    requestHash,
    statusCode,
    bodyJson: JSON.stringify(body ?? null),
    expiresAtMs: Date.now() + TTL_MS
  });
}

async function lookupPostgres(
  key: string,
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
    [key, method, path]
  );
  const row = result.rows[0];
  if (!row) {
    return { kind: "miss" };
  }
  if (row.expires_at.getTime() <= Date.now()) {
    await pool.query(`DELETE FROM http_idempotency WHERE idempotency_key = $1`, [key]);
    return { kind: "miss" };
  }
  if (row.request_hash !== requestHash) {
    return { kind: "conflict" };
  }
  return { kind: "hit", statusCode: row.status_code, body: row.response_body };
}

async function storePostgres(
  key: string,
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
     ON CONFLICT (idempotency_key) DO UPDATE SET
       method = EXCLUDED.method,
       path = EXCLUDED.path,
       request_hash = EXCLUDED.request_hash,
       status_code = EXCLUDED.status_code,
       response_body = EXCLUDED.response_body,
       expires_at = EXCLUDED.expires_at`,
    [key, method, path, requestHash, statusCode, body ?? null, expiresAt]
  );
}

export async function resolveIdempotentRequest(
  request: FastifyRequest,
  bodyForHash: unknown
): Promise<IdempotencyLookupResult> {
  const key = readIdempotencyKey(request);
  if (!key) {
    return { kind: "miss" };
  }
  const requestHash = hashHttpRequestBody(bodyForHash);
  if (isRoomPersistenceEnabled()) {
    return lookupPostgres(key, request.method, readRequestPath(request), requestHash);
  }
  return lookupMemory(key, requestHash);
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
  storeMemory(key, requestHash, statusCode, body);
}

/** @deprecated Use resolveIdempotentRequest — kept for unit tests. */
export function lookupIdempotentResponse(
  key: string,
  requestHash: string
): { statusCode: number; body: unknown } | null {
  const resolved = lookupMemory(key, requestHash);
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
  body: unknown
): void {
  storeMemory(key, requestHash, statusCode, body);
}

export function clearHttpIdempotencyStoreForTests(): void {
  memoryStore.clear();
}
