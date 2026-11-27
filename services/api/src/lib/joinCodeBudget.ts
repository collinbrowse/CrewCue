/**
 * Shared budget for room code lookups that find no room (`POST /race-rooms/join-by-code`,
 * `GET /race-rooms/join-preview/:roomCode`). Counted per account (per client address when signed
 * out), in fixed one-hour windows. Postgres keeps the counts so every API instance shares them
 * (migration 0026); memory mode keeps a map. The per-route rate limits in `plugins/rateLimit.ts`
 * still apply first, per process.
 */
import { getPersistencePool } from "./roomPersistence.js";

export const JOIN_CODE_FAILURE_BUDGET = {
  windowMs: 60 * 60 * 1000,
  /** Unknown codes one account (or one signed-out address) may try per window. */
  perSubject: 20
} as const;

/** Old windows are deleted at most this often per process. */
const PRUNE_EVERY_MS = 10 * 60 * 1000;

const memory = new Map<string, number>();
let lastPruneMs = 0;

function windowStartMs(nowMs: number): number {
  return Math.floor(nowMs / JOIN_CODE_FAILURE_BUDGET.windowMs) * JOIN_CODE_FAILURE_BUDGET.windowMs;
}

function subjectBucket(subject: string): string {
  return `subject:${subject}`;
}

function memoryKey(bucket: string, windowStart: number): string {
  return `${windowStart}\u0000${bucket}`;
}

/**
 * Seconds until the caller may look up a code again, or null while the budget has room. Check
 * before the lookup, so a spent budget answers without saying whether a code exists.
 */
export async function joinCodeBudgetRetryAfterSeconds(subject: string, nowMs = Date.now()): Promise<number | null> {
  const windowStart = windowStartMs(nowMs);
  const bucket = subjectBucket(subject);
  let failures = 0;
  const pool = getPersistencePool();
  if (!pool) {
    failures = memory.get(memoryKey(bucket, windowStart)) ?? 0;
  } else {
    const result = await pool.query<{ failures: number }>(
      `SELECT failures FROM join_code_failures
       WHERE window_start = to_timestamp($1::double precision / 1000) AND bucket = $2`,
      [windowStart, bucket]
    );
    failures = result.rows[0]?.failures ?? 0;
  }
  if (failures < JOIN_CODE_FAILURE_BUDGET.perSubject) {
    return null;
  }
  return Math.max(1, Math.ceil((windowStart + JOIN_CODE_FAILURE_BUDGET.windowMs - nowMs) / 1000));
}

/** Counts one lookup by the caller that found no room. */
export async function recordJoinCodeFailure(subject: string, nowMs = Date.now()): Promise<void> {
  const windowStart = windowStartMs(nowMs);
  const bucket = subjectBucket(subject);
  const pool = getPersistencePool();
  const prune = nowMs - lastPruneMs >= PRUNE_EVERY_MS;
  if (prune) lastPruneMs = nowMs;
  if (!pool) {
    const key = memoryKey(bucket, windowStart);
    memory.set(key, (memory.get(key) ?? 0) + 1);
    if (prune) {
      for (const existing of memory.keys()) {
        if (Number(existing.split("\u0000")[0]) < windowStart) memory.delete(existing);
      }
    }
    return;
  }
  await pool.query(
    `INSERT INTO join_code_failures (bucket, window_start, failures)
     VALUES ($1, to_timestamp($2::double precision / 1000), 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET failures = join_code_failures.failures + 1`,
    [bucket, windowStart]
  );
  if (prune) {
    await pool.query("DELETE FROM join_code_failures WHERE window_start < to_timestamp($1::double precision / 1000)", [
      windowStart
    ]);
  }
}

/** Test hook: forget every count (memory and Postgres). */
export async function resetJoinCodeBudgetForTests(): Promise<void> {
  memory.clear();
  lastPruneMs = 0;
  const pool = getPersistencePool();
  if (pool) await pool.query("DELETE FROM join_code_failures");
}
