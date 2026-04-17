import { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { RaceRoom, RaceRoomInvite } from "@crewcue/contracts";

const DATABASE_URL = process.env.DATABASE_URL;
const ROOM_PERSISTENCE_BACKEND = process.env.ROOM_PERSISTENCE_BACKEND ?? "memory";
const pool = ROOM_PERSISTENCE_BACKEND === "postgres" && DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

let initialized = false;

export function isRoomPersistenceEnabled(): boolean {
  return pool !== null;
}

export async function initRoomPersistence(log: FastifyBaseLogger): Promise<void> {
  if (!pool || initialized) {
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS race_rooms_json (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS race_room_invites_json (
      token TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  initialized = true;
  log.info({ persistence: { backend: "postgres", tables: ["race_rooms_json", "race_room_invites_json"] } }, "room_persistence_ready");
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
