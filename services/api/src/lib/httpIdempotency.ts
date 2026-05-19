import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const TTL_MS = 24 * 60 * 60 * 1000;

type StoredIdempotentResponse = {
  requestHash: string;
  statusCode: number;
  bodyJson: string;
  expiresAtMs: number;
};

const store = new Map<string, StoredIdempotentResponse>();

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

export function lookupIdempotentResponse(
  key: string,
  requestHash: string
): { statusCode: number; body: unknown } | null {
  const row = store.get(key);
  if (!row || row.expiresAtMs <= Date.now()) {
    store.delete(key);
    return null;
  }
  if (row.requestHash !== requestHash) {
    return null;
  }
  return { statusCode: row.statusCode, body: JSON.parse(row.bodyJson) as unknown };
}

export function storeIdempotentResponse(
  key: string,
  requestHash: string,
  statusCode: number,
  body: unknown
): void {
  store.set(key, {
    requestHash,
    statusCode,
    bodyJson: JSON.stringify(body ?? null),
    expiresAtMs: Date.now() + TTL_MS
  });
}

export function tryReplayIdempotentResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  bodyForHash: unknown
): FastifyReply | null {
  const key = readIdempotencyKey(request);
  if (!key) {
    return null;
  }
  const requestHash = hashHttpRequestBody(bodyForHash);
  const cached = lookupIdempotentResponse(key, requestHash);
  if (!cached) {
    return null;
  }
  return reply.code(cached.statusCode).send(cached.body);
}

export function persistIdempotentResponse(
  request: FastifyRequest,
  bodyForHash: unknown,
  statusCode: number,
  body: unknown
): void {
  const key = readIdempotencyKey(request);
  if (!key) {
    return;
  }
  storeIdempotentResponse(key, hashHttpRequestBody(bodyForHash), statusCode, body);
}

export function clearHttpIdempotencyStoreForTests(): void {
  store.clear();
}
