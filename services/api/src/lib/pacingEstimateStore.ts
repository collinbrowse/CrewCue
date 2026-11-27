/**
 * Durable pacing-estimate store for Wave 3 (W3-4 attach-by-id).
 * Ownership: athleteUserId (creator). Memory for PERSISTENCE_MODE=memory; Postgres JSON when postgres.
 * Payload may include optional baselineTrack (micro-model moving plan) alongside the estimate,
 * the race rooms it was computed for or attached to, and the course length it was computed for.
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
const pool = MODE === "postgres" ? new Pool({ connectionString: DATABASE_URL, allowExitOnIdle: true }) : null;

let initPromise: Promise<void> | null = null;
let initialized = false;

/**
 * Every row written from now on carries this version. A row without it is legacy, stored before
 * provenance was a set: before #724 a row had none, and #724 kept a single `roomId`, which reads
 * as a set of that one room. See `legacyProvenance`.
 */
export const PACING_ESTIMATE_PROVENANCE_VERSION = 1;

/** What one save adds to a stored estimate's provenance. */
export type PacingEstimateProvenance = {
  /**
   * The race room it is computed for or attached to. Added to `roomIds`: a save never removes a
   * room an earlier save recorded. Absent for a room-less estimate.
   */
  roomId?: string;
  /** The course length (m) it was computed for. When absent, the stored row's length is kept. */
  courseLengthMeters?: number;
};

export type StoredPacingEstimate = {
  athleteUserId: string;
  estimate: PacingEstimate;
  /** Micro-model expected moving curve; written to course.baselineTrack on attach. */
  baselineTrack?: RaceCourseBaselineTrack;
  /**
   * Every race room it was computed for or attached to, sorted. Estimate ids follow their inputs
   * (no room, no user), so one row can serve several races, and the set only grows.
   */
  roomIds: string[];
  /**
   * True when the row was stored without `PACING_ESTIMATE_PROVENANCE_VERSION`, so `roomIds` may
   * miss races it went to. Any save through `savePacingEstimate` upgrades the row.
   */
  legacyProvenance: boolean;
  /** The course length (m) it was computed for. Absent on legacy rows. */
  courseLengthMeters?: number;
};

/** estimateId → stored row, kept as the raw payload so memory and Postgres read rows the same way. */
const memoryById = new Map<string, { athleteUserId: string; payload: unknown }>();

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

/** The payload written from now on. Legacy payloads have no `provenanceVersion` and no `roomIds`. */
type StoredPayload = {
  provenanceVersion: typeof PACING_ESTIMATE_PROVENANCE_VERSION;
  estimate: PacingEstimate;
  baselineTrack?: RaceCourseBaselineTrack;
  roomIds: string[];
  courseLengthMeters?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The rooms a payload records: its `roomIds`, plus the single `roomId` a #724 row kept. */
function recordedRoomIds(payload: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  if (Array.isArray(payload.roomIds)) {
    for (const id of payload.roomIds) if (typeof id === "string") ids.add(id);
  }
  if (typeof payload.roomId === "string") ids.add(payload.roomId);
  return [...ids].sort();
}

function positiveLength(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseStoredPayload(raw: unknown): Omit<StoredPacingEstimate, "athleteUserId"> {
  if (isRecord(raw) && "estimate" in raw) {
    const courseLengthMeters = positiveLength(raw.courseLengthMeters);
    return {
      estimate: parsePacingEstimate(raw.estimate),
      ...(raw.baselineTrack ? { baselineTrack: raw.baselineTrack as RaceCourseBaselineTrack } : {}),
      roomIds: recordedRoomIds(raw),
      legacyProvenance: raw.provenanceVersion !== PACING_ESTIMATE_PROVENANCE_VERSION,
      ...(courseLengthMeters !== undefined ? { courseLengthMeters } : {})
    };
  }
  // The oldest rows are the bare estimate.
  return { estimate: parsePacingEstimate(raw), roomIds: [], legacyProvenance: true };
}

/**
 * Saves the estimate, replacing the stored estimate and plan curve, and adds `provenance.roomId`
 * to the rooms already recorded for that id (a legacy row's `roomId` included). Postgres merges
 * the set inside the upsert, so two saves for different rooms at once both stay recorded.
 * Returns the row as stored.
 */
export async function savePacingEstimate(
  athleteUserId: string,
  estimate: PacingEstimate,
  baselineTrack?: RaceCourseBaselineTrack,
  provenance: PacingEstimateProvenance = {}
): Promise<StoredPacingEstimate> {
  await ensureReady();
  const parsed = parsePacingEstimate(estimate);
  const courseLengthMeters = positiveLength(provenance.courseLengthMeters);
  const payload: StoredPayload = {
    provenanceVersion: PACING_ESTIMATE_PROVENANCE_VERSION,
    estimate: parsed,
    ...(baselineTrack ? { baselineTrack } : {}),
    roomIds: typeof provenance.roomId === "string" ? [provenance.roomId] : [],
    ...(courseLengthMeters !== undefined ? { courseLengthMeters } : {})
  };

  if (!pool) {
    const existing = memoryById.get(parsed.id);
    const previous = existing && isRecord(existing.payload) ? existing.payload : {};
    const previousLength = positiveLength(previous.courseLengthMeters);
    const merged: StoredPayload = {
      ...payload,
      roomIds: [...new Set([...recordedRoomIds(previous), ...payload.roomIds])].sort(),
      ...(courseLengthMeters === undefined && previousLength !== undefined ? { courseLengthMeters: previousLength } : {})
    };
    memoryById.set(parsed.id, { athleteUserId, payload: merged });
    return { athleteUserId, ...parseStoredPayload(merged) };
  }

  const result = await pool.query<{ athlete_user_id: string; payload: unknown }>(
    `
    INSERT INTO pacing_estimate_json (estimate_id, athlete_user_id, payload, updated_at)
    VALUES ($1, $2, $3::jsonb, NOW())
    ON CONFLICT (estimate_id) DO UPDATE SET
      athlete_user_id = EXCLUDED.athlete_user_id,
      payload = EXCLUDED.payload
        || jsonb_build_object(
          'roomIds',
          (
            SELECT COALESCE(jsonb_agg(DISTINCT room_id ORDER BY room_id), '[]'::jsonb)
            FROM jsonb_array_elements_text(
              (CASE WHEN jsonb_typeof(pacing_estimate_json.payload -> 'roomIds') = 'array'
                THEN pacing_estimate_json.payload -> 'roomIds' ELSE '[]'::jsonb END)
              || (CASE WHEN jsonb_typeof(pacing_estimate_json.payload -> 'roomId') = 'string'
                THEN jsonb_build_array(pacing_estimate_json.payload -> 'roomId') ELSE '[]'::jsonb END)
              || (EXCLUDED.payload -> 'roomIds')
            ) AS room_id
          )
        )
        || (CASE WHEN NOT (EXCLUDED.payload ? 'courseLengthMeters')
                  AND jsonb_typeof(pacing_estimate_json.payload -> 'courseLengthMeters') = 'number'
          THEN jsonb_build_object('courseLengthMeters', pacing_estimate_json.payload -> 'courseLengthMeters')
          ELSE '{}'::jsonb END),
      updated_at = NOW()
    RETURNING athlete_user_id, payload
    `,
    [parsed.id, athleteUserId, JSON.stringify(payload)]
  );
  const row = result.rows[0]!;
  return { athleteUserId: row.athlete_user_id, ...parseStoredPayload(row.payload) };
}

/**
 * Attaching an estimate to a race records that race on it (added to `roomIds`), so the export
 * and later attaches know where it went. The estimate, its plan curve and its course length are
 * kept as stored. No write when the row already records the race.
 */
export async function recordPacingEstimateRoom(stored: StoredPacingEstimate, roomId: string): Promise<void> {
  if (!stored.legacyProvenance && stored.roomIds.includes(roomId)) return;
  await savePacingEstimate(stored.athleteUserId, stored.estimate, stored.baselineTrack, {
    roomId,
    ...(stored.courseLengthMeters !== undefined ? { courseLengthMeters: stored.courseLengthMeters } : {})
  });
}

/**
 * Test helper: write a row the way an older build stored it. With `roomId` it is a #724 row (one
 * recorded room); without, a row from before #724 (no provenance at all).
 */
export async function saveLegacyPacingEstimateForTests(
  athleteUserId: string,
  estimate: PacingEstimate,
  options: { baselineTrack?: RaceCourseBaselineTrack; roomId?: string } = {}
): Promise<void> {
  await ensureReady();
  const parsed = parsePacingEstimate(estimate);
  const payload = {
    estimate: parsed,
    ...(options.baselineTrack ? { baselineTrack: options.baselineTrack } : {}),
    ...(options.roomId ? { roomId: options.roomId } : {})
  };
  if (!pool) {
    memoryById.set(parsed.id, { athleteUserId, payload });
    return;
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
}

export async function getPacingEstimateById(estimateId: string): Promise<StoredPacingEstimate | undefined> {
  await ensureReady();
  if (!pool) {
    const row = memoryById.get(estimateId);
    return row ? { athleteUserId: row.athleteUserId, ...parseStoredPayload(row.payload) } : undefined;
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
    return [...memoryById.values()]
      .filter((row) => row.athleteUserId === athleteUserId)
      .map((row) => ({ athleteUserId: row.athleteUserId, ...parseStoredPayload(row.payload) }));
  }
  const result = await pool.query<{ athlete_user_id: string; payload: unknown }>(
    `SELECT athlete_user_id, payload FROM pacing_estimate_json WHERE athlete_user_id = $1 ORDER BY updated_at ASC`,
    [athleteUserId]
  );
  return result.rows.map((row) => ({ athleteUserId: row.athlete_user_id, ...parseStoredPayload(row.payload) }));
}
