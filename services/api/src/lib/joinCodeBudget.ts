/**
 * Shared budget for room code lookups that find no room (`POST /race-rooms/join-by-code`,
 * `GET /race-rooms/join-preview/:roomCode`). Counted per account (per client address when signed
 * out) and across everyone, in fixed one-hour windows. Postgres keeps the counts so every API
 * instance shares them (migration 0026); memory mode keeps a map. The per-route rate limits in
 * `plugins/rateLimit.ts` still apply first, per process.
 */
import { getPersistencePool } from "./roomPersistence.js";

/**
 * Unknown codes all callers together may try per window. The only place the global cap is set:
 * change it here (or drop the `global` check in `joinCodeBudgetRetryAfterSeconds` to remove it).
 */
export const JOIN_CODE_GLOBAL_FAILURE_CAP = 500;

export const JOIN_CODE_FAILURE_BUDGET = {
  windowMs: 60 * 60 * 1000,
  /** Unknown codes one account (or one signed-out address) may try per window. */
  perSubject: 20,
  global: JOIN_CODE_GLOBAL_FAILURE_CAP
} as const;

const GLOBAL_BUCKET = "global";
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
  const subjectKey = subjectBucket(subject);
  let subjectFailures = 0;
  let globalFailures = 0;
  const pool = getPersistencePool();
  if (!pool) {
    subjectFailures = memory.get(memoryKey(subjectKey, windowStart)) ?? 0;
    globalFailures = memory.get(memoryKey(GLOBAL_BUCKET, windowStart)) ?? 0;
  } else {
    const result = await pool.query<{ bucket: string; failures: number }>(
      `SELECT bucket, failures FROM join_code_failures
       WHERE window_start = to_timestamp($1::double precision / 1000) AND bucket = ANY($2::text[])`,
      [windowStart, [subjectKey, GLOBAL_BUCKET]]
    );
    for (const row of result.rows) {
      if (row.bucket === GLOBAL_BUCKET) globalFailures = row.failures;
      else subjectFailures = row.failures;
    }
  }
  if (subjectFailures < JOIN_CODE_FAILURE_BUDGET.perSubject && globalFailures < JOIN_CODE_FAILURE_BUDGET.global) {
    return null;
  }
  return Math.max(1, Math.ceil((windowStart + JOIN_CODE_FAILURE_BUDGET.windowMs - nowMs) / 1000));
}

/** Counts one lookup that found no room, for the caller and for everyone. */
export async function recordJoinCodeFailure(subject: string, nowMs = Date.now()): Promise<void> {
  const windowStart = windowStartMs(nowMs);
  const buckets = [subjectBucket(subject), GLOBAL_BUCKET];
  const pool = getPersistencePool();
  const prune = nowMs - lastPruneMs >= PRUNE_EVERY_MS;
  if (prune) lastPruneMs = nowMs;
  if (!pool) {
    for (const bucket of buckets) {
      const key = memoryKey(bucket, windowStart);
      memory.set(key, (memory.get(key) ?? 0) + 1);
    }
    if (prune) {
      for (const key of memory.keys()) {
        if (Number(key.split("\u0000")[0]) < windowStart) memory.delete(key);
      }
    }
    return;
  }
  await pool.query(
    `INSERT INTO join_code_failures (bucket, window_start, failures)
     SELECT bucket, to_timestamp($2::double precision / 1000), 1 FROM unnest($1::text[]) AS bucket
     ON CONFLICT (bucket, window_start) DO UPDATE SET failures = join_code_failures.failures + 1`,
    [buckets, windowStart]
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
