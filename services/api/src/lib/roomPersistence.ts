import { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { RaceRoom, RaceRoomInvite } from "@crewcue/contracts";

export type PersistenceMode = "memory" | "postgres";

const DATABASE_URL = process.env.DATABASE_URL;

function resolvePersistenceMode(): PersistenceMode {
  const raw = process.env.PERSISTENCE_MODE;
  if (!raw || raw === "memory") {
    return "memory";
  }
  if (raw === "postgres") {
    return "postgres";
  }
  throw new Error(`Invalid PERSISTENCE_MODE '${raw}'. Expected 'memory' or 'postgres'.`);
}

const PERSISTENCE_MODE = resolvePersistenceMode();
const pool = PERSISTENCE_MODE === "postgres" ? new Pool({ connectionString: DATABASE_URL }) : null;

let initialized = false;
let initPromise: Promise<void> | null = null;

export function isRoomPersistenceEnabled(): boolean {
  return pool !== null;
}

export function getRoomPersistenceMode(): PersistenceMode {
  return PERSISTENCE_MODE;
}

export function validateRoomPersistenceEnv(): void {
  if (PERSISTENCE_MODE === "postgres" && !DATABASE_URL) {
    throw new Error("PERSISTENCE_MODE=postgres requires DATABASE_URL.");
  }
}

export async function initRoomPersistence(log: FastifyBaseLogger): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }
  initPromise = (async () => {
  if (initialized) {
    return;
  }
  if (!pool) {
    initialized = true;
    log.info({ persistence: { mode: PERSISTENCE_MODE } }, "room_persistence_ready");
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(711001)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS race_rooms_json (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS race_room_invites_json (
        token TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_task_boards_json (
        room_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_ws2_runtime_json (
        room_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_ws4_adaptive_json (
        room_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_ws5_sync_json (
        room_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } finally {
    await client.query("SELECT pg_advisory_unlock(711001)");
    client.release();
  }
  initialized = true;
  log.info(
    {
      persistence: {
        mode: PERSISTENCE_MODE,
        tables: [
          "race_rooms_json",
          "race_room_invites_json",
          "room_task_boards_json",
          "room_ws2_runtime_json",
          "room_ws4_adaptive_json",
          "room_ws5_sync_json"
        ]
      }
    },
    "room_persistence_ready"
  );
  })();
  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

export async function persistRaceRoom(room: RaceRoom): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(
    `
      INSERT INTO race_rooms_json (id, team_id, payload, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE
      SET team_id = EXCLUDED.team_id,
          payload = EXCLUDED.payload,
          updated_at = NOW();
    `,
    [room.id, room.teamId, JSON.stringify(room)]
  );
}

export async function loadRaceRoom(roomId: string): Promise<RaceRoom | undefined> {
  if (!pool) {
    return undefined;
  }
  const result = await pool.query<{ payload: RaceRoom }>(
    "SELECT payload FROM race_rooms_json WHERE id = $1 LIMIT 1",
    [roomId]
  );
  return result.rows[0]?.payload;
}

export async function listPersistedRaceRoomsByTeamId(teamId: string): Promise<RaceRoom[]> {
  if (!pool) {
    return [];
  }
  const result = await pool.query<{ payload: RaceRoom }>(
    "SELECT payload FROM race_rooms_json WHERE team_id = $1",
    [teamId]
  );
  return result.rows.map((r) => r.payload);
}

export async function persistRaceRoomInvite(invite: RaceRoomInvite): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(
    `
      INSERT INTO race_room_invites_json (token, room_id, payload, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (token) DO UPDATE
      SET room_id = EXCLUDED.room_id,
          payload = EXCLUDED.payload,
          updated_at = NOW();
    `,
    [invite.token, invite.roomId, JSON.stringify(invite)]
  );
}

export async function loadRaceRoomInvite(token: string): Promise<RaceRoomInvite | undefined> {
  if (!pool) {
    return undefined;
  }
  const result = await pool.query<{ payload: RaceRoomInvite }>(
    "SELECT payload FROM race_room_invites_json WHERE token = $1 LIMIT 1",
    [token]
  );
  return result.rows[0]?.payload;
}

export async function persistTaskBoardPayload(roomId: string, payload: unknown): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(
    `
      INSERT INTO room_task_boards_json (room_id, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (room_id) DO UPDATE
      SET payload = EXCLUDED.payload,
          updated_at = NOW();
    `,
    [roomId, JSON.stringify(payload)]
  );
}

export async function loadTaskBoardPayload(roomId: string): Promise<unknown | undefined> {
  if (!pool) {
    return undefined;
  }
  const result = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM room_task_boards_json WHERE room_id = $1 LIMIT 1",
    [roomId]
  );
  return result.rows[0]?.payload;
}

export async function deleteTaskBoardPayload(roomId: string): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query("DELETE FROM room_task_boards_json WHERE room_id = $1", [roomId]);
}

export async function persistWs2RuntimePayload(roomId: string, payload: unknown): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(
    `
      INSERT INTO room_ws2_runtime_json (room_id, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (room_id) DO UPDATE
      SET payload = EXCLUDED.payload,
          updated_at = NOW();
    `,
    [roomId, JSON.stringify(payload)]
  );
}

export async function loadWs2RuntimePayload(roomId: string): Promise<unknown | undefined> {
  if (!pool) {
    return undefined;
  }
  const result = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM room_ws2_runtime_json WHERE room_id = $1 LIMIT 1",
    [roomId]
  );
  return result.rows[0]?.payload;
}

export async function deleteWs2RuntimePayload(roomId: string): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query("DELETE FROM room_ws2_runtime_json WHERE room_id = $1", [roomId]);
}

export async function persistWs4AdaptivePayload(roomId: string, payload: unknown): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(
    `
      INSERT INTO room_ws4_adaptive_json (room_id, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (room_id) DO UPDATE
      SET payload = EXCLUDED.payload,
          updated_at = NOW();
    `,
    [roomId, JSON.stringify(payload)]
  );
}

export async function loadWs4AdaptivePayload(roomId: string): Promise<unknown | undefined> {
  if (!pool) {
    return undefined;
  }
  const result = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM room_ws4_adaptive_json WHERE room_id = $1 LIMIT 1",
    [roomId]
  );
  return result.rows[0]?.payload;
}

export async function deleteWs4AdaptivePayload(roomId: string): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query("DELETE FROM room_ws4_adaptive_json WHERE room_id = $1", [roomId]);
}

export async function persistWs5SyncPayload(roomId: string, payload: unknown): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(
    `
      INSERT INTO room_ws5_sync_json (room_id, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (room_id) DO UPDATE
      SET payload = EXCLUDED.payload,
          updated_at = NOW();
    `,
    [roomId, JSON.stringify(payload)]
  );
}

export async function loadWs5SyncPayload(roomId: string): Promise<unknown | undefined> {
  if (!pool) {
    return undefined;
  }
  const result = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM room_ws5_sync_json WHERE room_id = $1 LIMIT 1",
    [roomId]
  );
  return result.rows[0]?.payload;
}

export async function deleteWs5SyncPayload(roomId: string): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query("DELETE FROM room_ws5_sync_json WHERE room_id = $1", [roomId]);
}
