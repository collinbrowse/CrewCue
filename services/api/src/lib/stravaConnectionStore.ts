/**
 * Durable Strava OAuth connection store (W3-2).
 * Memory for PERSISTENCE_MODE=memory; Postgres when postgres.
 * Tokens never leave this module via public API responses.
 */
import { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { StravaTokenBundle } from "./strava/stravaClient.js";

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

type StoredConnection = {
  athleteUserId: string;
  tokens: StravaTokenBundle;
  updatedAt: string;
};

/** OAuth CSRF state → athlete + expiry */
type PendingOAuth = {
  athleteUserId: string;
  expiresAtMs: number;
};

const memoryConnections = new Map<string, StoredConnection>();
const memoryPending = new Map<string, PendingOAuth>();

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

export function isStravaConnectionPostgres(): boolean {
  return pool !== null;
}

export async function initStravaConnectionStore(log: FastifyBaseLogger): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }
  initPromise = (async () => {
    if (initialized) return;
    if (!pool) {
      initialized = true;
      log.info({ stravaConnection: { mode: MODE } }, "strava_connection_store_ready");
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(711320)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS strava_connection_json (
          athlete_user_id TEXT PRIMARY KEY,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          expires_at BIGINT NOT NULL,
          strava_athlete_id TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS strava_oauth_pending (
          state TEXT PRIMARY KEY,
          athlete_user_id TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        );
      `);
    } finally {
      await client.query("SELECT pg_advisory_unlock(711320)");
      client.release();
    }
    initialized = true;
    log.info({ stravaConnection: { mode: MODE } }, "strava_connection_store_ready");
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
  await initStravaConnectionStore(NOOP_LOGGER);
}

export async function resetStravaConnectionStoreForTests(): Promise<void> {
  memoryConnections.clear();
  memoryPending.clear();
  initialized = false;
  initPromise = null;
  if (pool) {
    await initStravaConnectionStore(NOOP_LOGGER);
    await pool.query("TRUNCATE TABLE strava_connection_json");
    await pool.query("TRUNCATE TABLE strava_oauth_pending");
  }
}

export async function saveOAuthPendingState(state: string, athleteUserId: string): Promise<void> {
  await ensureReady();
  const expiresAtMs = Date.now() + OAUTH_STATE_TTL_MS;
  if (!pool) {
    memoryPending.set(state, { athleteUserId, expiresAtMs });
    return;
  }
  await pool.query(
    `INSERT INTO strava_oauth_pending (state, athlete_user_id, expires_at)
     VALUES ($1, $2, to_timestamp($3 / 1000.0))
     ON CONFLICT (state) DO UPDATE SET
       athlete_user_id = EXCLUDED.athlete_user_id,
       expires_at = EXCLUDED.expires_at`,
    [state, athleteUserId, expiresAtMs]
  );
}

/**
 * Consume (delete) a pending OAuth state if valid for the athlete.
 * @returns true when state matched and was not expired.
 */
export async function consumeOAuthPendingState(
  state: string,
  athleteUserId: string
): Promise<boolean> {
  await ensureReady();
  if (!pool) {
    const pending = memoryPending.get(state);
    memoryPending.delete(state);
    if (!pending) return false;
    if (pending.expiresAtMs < Date.now()) return false;
    return pending.athleteUserId === athleteUserId;
  }

  const result = await pool.query<{ athlete_user_id: string; expires_at: Date }>(
    `DELETE FROM strava_oauth_pending
     WHERE state = $1
     RETURNING athlete_user_id, expires_at`,
    [state]
  );
  const row = result.rows[0];
  if (!row) return false;
  if (row.expires_at.getTime() < Date.now()) return false;
  return row.athlete_user_id === athleteUserId;
}

export async function upsertStravaConnection(
  athleteUserId: string,
  tokens: StravaTokenBundle
): Promise<void> {
  await ensureReady();
  const updatedAt = new Date().toISOString();
  if (!pool) {
    memoryConnections.set(athleteUserId, {
      athleteUserId,
      tokens: { ...tokens },
      updatedAt
    });
    return;
  }
  await pool.query(
    `INSERT INTO strava_connection_json
       (athlete_user_id, access_token, refresh_token, expires_at, strava_athlete_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (athlete_user_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       strava_athlete_id = EXCLUDED.strava_athlete_id,
       updated_at = NOW()`,
    [athleteUserId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt, tokens.athleteId]
  );
}

export async function getStravaConnection(
  athleteUserId: string
): Promise<StravaTokenBundle | undefined> {
  await ensureReady();
  if (!pool) {
    const row = memoryConnections.get(athleteUserId);
    return row ? { ...row.tokens } : undefined;
  }
  const result = await pool.query<{
    access_token: string;
    refresh_token: string;
    expires_at: string;
    strava_athlete_id: string;
  }>(
    `SELECT access_token, refresh_token, expires_at, strava_athlete_id
     FROM strava_connection_json WHERE athlete_user_id = $1`,
    [athleteUserId]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: Number(row.expires_at),
    athleteId: row.strava_athlete_id
  };
}

export async function deleteStravaConnection(athleteUserId: string): Promise<boolean> {
  await ensureReady();
  if (!pool) {
    return memoryConnections.delete(athleteUserId);
  }
  const result = await pool.query(`DELETE FROM strava_connection_json WHERE athlete_user_id = $1`, [
    athleteUserId
  ]);
  return (result.rowCount ?? 0) > 0;
}

export type StravaConnectionPublic = {
  connected: boolean;
  athleteId?: string;
};

export async function getStravaConnectionPublic(
  athleteUserId: string
): Promise<StravaConnectionPublic> {
  const tokens = await getStravaConnection(athleteUserId);
  if (!tokens) {
    return { connected: false };
  }
  return { connected: true, athleteId: tokens.athleteId };
}
