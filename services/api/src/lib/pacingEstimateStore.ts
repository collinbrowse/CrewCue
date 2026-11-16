/**
 * Durable pacing-estimate store for Wave 3 (W3-4 attach-by-id).
 * Ownership: athleteUserId (creator). Memory for PERSISTENCE_MODE=memory; Postgres JSON when postgres.
 * Payload may include optional baselineTrack (micro-model moving plan) alongside the estimate,
 * and the race room it was computed for or last attached to.
 */
import { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { PacingEstimate, RaceCourseBaselineTrack } from "@crewcue/contracts";
import { parsePacingEstimate } from "@crewcue/contracts";

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

/** Where an estimate went, so the export knows whether a paid race unlocked it. */
export type PacingEstimateProvenance = {
  /**
   * The race room it was computed for, or last attached to (attaching records it). Absent for a
   * room-less estimate that was never attached.
   */
  roomId?: string;
};

export type StoredPacingEstimate = PacingEstimateProvenance & {
  athleteUserId: string;
  estimate: PacingEstimate;
  /** Micro-model expected moving curve; written to course.baselineTrack on attach. */
  baselineTrack?: RaceCourseBaselineTrack;
};

/** estimateId → stored row */
const memoryById = new Map<string, StoredPacingEstimate>();

export function isPacingEstimatePostgres(): boolean {
  return pool !== null;
}

export async function initPacingEstimateStore(log: FastifyBaseLogger): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }
  initPromise = (async () => {
    if (initialized) return;
    if (!pool) {
      initialized = true;
      log.info({ pacingEstimate: { mode: MODE } }, "pacing_estimate_store_ready");
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(711311)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS pacing_estimate_json (
          estimate_id TEXT PRIMARY KEY,
          athlete_user_id TEXT NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS pacing_estimate_json_athlete
        ON pacing_estimate_json (athlete_user_id);
      `);
    } finally {
      await client.query("SELECT pg_advisory_unlock(711311)");
      client.release();
    }
    initialized = true;
    log.info({ pacingEstimate: { mode: MODE } }, "pacing_estimate_store_ready");
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
  await initPacingEstimateStore(NOOP_LOGGER);
}

/**
 * Test helper: clear in-memory rows and truncate Postgres table between cases.
 */
export async function resetPacingEstimateStoreForTests(): Promise<void> {
  memoryById.clear();
  initialized = false;
  initPromise = null;
  if (pool) {
    await initPacingEstimateStore(NOOP_LOGGER);
    await pool.query("TRUNCATE TABLE pacing_estimate_json");
  }
}

type StoredPayload = PacingEstimateProvenance & {
  estimate: PacingEstimate;
  baselineTrack?: RaceCourseBaselineTrack;
};

function provenanceOf(source: PacingEstimateProvenance): PacingEstimateProvenance {
  return typeof source.roomId === "string" ? { roomId: source.roomId } : {};
}

function parseStoredPayload(raw: unknown): Omit<StoredPacingEstimate, "athleteUserId"> {
  if (raw && typeof raw === "object" && "estimate" in (raw as object)) {
    const envelope = raw as StoredPayload;
    return {
      estimate: parsePacingEstimate(envelope.estimate),
      ...(envelope.baselineTrack ? { baselineTrack: envelope.baselineTrack } : {}),
      ...provenanceOf(envelope)
    };
  }
  return { estimate: parsePacingEstimate(raw) };
}

export async function savePacingEstimate(
  athleteUserId: string,
  estimate: PacingEstimate,
  baselineTrack?: RaceCourseBaselineTrack,
  provenance: PacingEstimateProvenance = {}
): Promise<StoredPacingEstimate> {
  await ensureReady();
  const parsed = parsePacingEstimate(estimate);
  const payload: StoredPayload = {
    estimate: parsed,
    ...(baselineTrack ? { baselineTrack } : {}),
    ...provenanceOf(provenance)
  };
  const row: StoredPacingEstimate = { athleteUserId, ...payload };

  if (!pool) {
    memoryById.set(parsed.id, row);
    return row;
  }

  await pool.query(
    `
    INSERT INTO pacing_estimate_json (estimate_id, athlete_user_id, payload, updated_at)
    VALUES ($1, $2, $3::jsonb, NOW())
    ON CONFLICT (estimate_id) DO UPDATE SET
      athlete_user_id = EXCLUDED.athlete_user_id,
      payload = EXCLUDED.payload,
      updated_at = NOW()
    `,
    [parsed.id, athleteUserId, JSON.stringify(payload)]
  );
  return row;
}

/**
 * Attaching an estimate to a race records that race on it, so the export knows where it went.
 * The estimate and its plan curve are kept as stored.
 */
export async function recordPacingEstimateRoom(stored: StoredPacingEstimate, roomId: string): Promise<void> {
  if (stored.roomId === roomId) return;
  await savePacingEstimate(stored.athleteUserId, stored.estimate, stored.baselineTrack, { roomId });
}

export async function getPacingEstimateById(estimateId: string): Promise<StoredPacingEstimate | undefined> {
  await ensureReady();
  if (!pool) {
    return memoryById.get(estimateId);
  }
  const result = await pool.query<{ athlete_user_id: string; payload: unknown }>(
    `SELECT athlete_user_id, payload FROM pacing_estimate_json WHERE estimate_id = $1`,
    [estimateId]
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  return { athleteUserId: row.athlete_user_id, ...parseStoredPayload(row.payload) };
}

/** Account deletion: drop every pacing estimate owned by this athlete. Returns rows removed. */
export async function deletePacingEstimatesForAthlete(athleteUserId: string): Promise<number> {
  await ensureReady();
  if (!pool) {
    let removed = 0;
    for (const [id, row] of [...memoryById.entries()]) {
      if (row.athleteUserId !== athleteUserId) continue;
      memoryById.delete(id);
      removed += 1;
    }
    return removed;
  }
  const result = await pool.query(`DELETE FROM pacing_estimate_json WHERE athlete_user_id = $1`, [athleteUserId]);
  return result.rowCount ?? 0;
}

/** Account export: estimates owned by this athlete. */
export async function listPacingEstimatesForAthlete(athleteUserId: string): Promise<StoredPacingEstimate[]> {
  await ensureReady();
  if (!pool) {
    return [...memoryById.values()].filter((row) => row.athleteUserId === athleteUserId);
  }
  const result = await pool.query<{ athlete_user_id: string; payload: unknown }>(
    `SELECT athlete_user_id, payload FROM pacing_estimate_json WHERE athlete_user_id = $1 ORDER BY updated_at ASC`,
    [athleteUserId]
  );
  return result.rows.map((row) => ({ athleteUserId: row.athlete_user_id, ...parseStoredPayload(row.payload) }));
}
