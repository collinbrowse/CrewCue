/**
 * Durable activity-history store for Wave 3 pacing (W3-1).
 * Idempotency key: athleteUserId + source + externalId.
 * Memory for PERSISTENCE_MODE=memory; Postgres JSON rows when postgres.
 */
import { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { ActivityHistoryRef, ActivityHistorySource } from "@crewcue/contracts";
import { parseActivityHistoryRef } from "@crewcue/contracts";

type Mode = "memory" | "postgres";

const DATABASE_URL = process.env.DATABASE_URL;

function resolveMode(): Mode {
  const raw = process.env.PERSISTENCE_MODE;
  if (!raw || raw === "memory") return "memory";
  if (raw === "postgres") return "postgres";
  throw new Error(`Invalid PERSISTENCE_MODE '${raw}'.`);
}

const MODE = resolveMode();
const pool = MODE === "postgres" ? new Pool({ connectionString: DATABASE_URL }) : null;

let initPromise: Promise<void> | null = null;
let initialized = false;

/** athleteUserId|source|externalId → stored row */
const memoryByKey = new Map<string, StoredActivityHistory>();
/** history id → key (scoped lookups) */
const memoryIdIndex = new Map<string, string>();

export type StoredActivityHistory = {
  athleteUserId: string;
  ref: ActivityHistoryRef;
};

function idempotencyKey(athleteUserId: string, source: ActivityHistorySource, externalId: string): string {
  return `${athleteUserId}|${source}|${externalId}`;
}

export function isActivityHistoryPostgres(): boolean {
  return pool !== null;
}

export async function initActivityHistoryStore(log: FastifyBaseLogger): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }
  initPromise = (async () => {
    if (initialized) return;
    if (!pool) {
      initialized = true;
      log.info({ activityHistory: { mode: MODE } }, "activity_history_store_ready");
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(711310)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS activity_history_json (
          athlete_user_id TEXT NOT NULL,
          source TEXT NOT NULL,
          external_id TEXT NOT NULL,
          history_id TEXT NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (athlete_user_id, source, external_id)
        );
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS activity_history_json_id
        ON activity_history_json (history_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS activity_history_json_athlete
        ON activity_history_json (athlete_user_id);
      `);
    } finally {
      await client.query("SELECT pg_advisory_unlock(711310)");
      client.release();
    }
    initialized = true;
    log.info({ activityHistory: { mode: MODE } }, "activity_history_store_ready");
  })();
  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

const NOOP_LOGGER = {
  info: () => {
    // no-op
  }
} as unknown as FastifyBaseLogger;

async function ensureReady(): Promise<void> {
  await initActivityHistoryStore(NOOP_LOGGER);
}

/** Test helper: clear in-memory rows between cases. */
export function resetActivityHistoryStoreForTests(): void {
  memoryByKey.clear();
  memoryIdIndex.clear();
  initialized = false;
  initPromise = null;
}

export type UpsertActivityHistoryResult = {
  ref: ActivityHistoryRef;
  /** false when an existing source+externalId row was returned unchanged (idempotent replay). */
  created: boolean;
};

export async function upsertActivityHistory(
  athleteUserId: string,
  ref: ActivityHistoryRef
): Promise<UpsertActivityHistoryResult> {
  await ensureReady();
  const key = idempotencyKey(athleteUserId, ref.source, ref.externalId);

  if (!pool) {
    const existing = memoryByKey.get(key);
    if (existing) {
      return { ref: existing.ref, created: false };
    }
    const stored: StoredActivityHistory = { athleteUserId, ref: structuredClone(ref) };
    memoryByKey.set(key, stored);
    memoryIdIndex.set(ref.id, key);
    return { ref: structuredClone(ref), created: true };
  }

  const existing = await pool.query<{ payload: unknown }>(
    `SELECT payload FROM activity_history_json
     WHERE athlete_user_id = $1 AND source = $2 AND external_id = $3`,
    [athleteUserId, ref.source, ref.externalId]
  );
  if (existing.rowCount && existing.rows[0]) {
    const parsed = parseActivityHistoryRef(existing.rows[0].payload);
    return { ref: parsed, created: false };
  }

  await pool.query(
    `INSERT INTO activity_history_json (athlete_user_id, source, external_id, history_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [athleteUserId, ref.source, ref.externalId, ref.id, JSON.stringify(ref)]
  );
  return { ref: structuredClone(ref), created: true };
}

export async function listActivityHistoryForAthlete(athleteUserId: string): Promise<ActivityHistoryRef[]> {
  await ensureReady();
  if (!pool) {
    return [...memoryByKey.values()]
      .filter((row) => row.athleteUserId === athleteUserId)
      .map((row) => structuredClone(row.ref))
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  }

  const result = await pool.query<{ payload: unknown }>(
    `SELECT payload FROM activity_history_json
     WHERE athlete_user_id = $1
     ORDER BY (payload->>'recordedAt') ASC`,
    [athleteUserId]
  );
  return result.rows.map((row) => parseActivityHistoryRef(row.payload));
}

export async function getActivityHistoryForAthlete(
  athleteUserId: string,
  historyId: string
): Promise<ActivityHistoryRef | undefined> {
  await ensureReady();
  if (!pool) {
    const key = memoryIdIndex.get(historyId);
    if (!key) return undefined;
    const row = memoryByKey.get(key);
    if (!row || row.athleteUserId !== athleteUserId) return undefined;
    return structuredClone(row.ref);
  }

  const result = await pool.query<{ payload: unknown; athlete_user_id: string }>(
    `SELECT payload, athlete_user_id FROM activity_history_json WHERE history_id = $1`,
    [historyId]
  );
  const row = result.rows[0];
  if (!row || row.athlete_user_id !== athleteUserId) return undefined;
  return parseActivityHistoryRef(row.payload);
}

export async function countActivityHistoryRows(): Promise<number> {
  await ensureReady();
  if (!pool) {
    return memoryByKey.size;
  }
  const result = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM activity_history_json`);
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}
