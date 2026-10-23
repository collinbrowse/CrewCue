import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  PlatformAggregateType,
  PlatformEventEnvelope,
  PlatformEventName,
  RaceRoom,
  RaceRoomInvite,
  ReplayedRaceRoomAggregate,
  TransportChannel
} from "@crewcue/contracts";
import { matchesPlatformEventIdempotencyInput } from "./platformEventIdempotency.js";

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

function cloneForStorage<T>(value: T): T {
  return structuredClone(value);
}

const memoryTaskBoardPayloads = new Map<string, unknown>();

export function isRoomPersistenceEnabled(): boolean {
  return pool !== null;
}

export function getPersistencePool(): Pool | null {
  return pool;
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_command_metric_configs_json (
        team_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_aggregate_heads (
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        last_sequence INT NOT NULL DEFAULT 0,
        PRIMARY KEY (aggregate_type, aggregate_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_domain_events (
        id TEXT PRIMARY KEY,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        sequence INT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload JSONB NOT NULL,
        schema_version TEXT NOT NULL,
        transport TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        correlation_id TEXT,
        causation_id TEXT,
        UNIQUE (aggregate_type, aggregate_id, sequence)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS platform_domain_events_by_aggregate
      ON platform_domain_events (aggregate_type, aggregate_id);
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS race_room_snapshots (
        aggregate_id TEXT PRIMARY KEY,
        last_sequence INT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_board_snapshots (
        aggregate_id TEXT PRIMARY KEY,
        version INT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS http_idempotency (
        idempotency_key TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        response_body JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        state TEXT NOT NULL DEFAULT 'complete',
        PRIMARY KEY (idempotency_key, method, path),
        CONSTRAINT http_idempotency_state_check CHECK (state IN ('processing', 'complete'))
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS http_idempotency_expires_at_idx ON http_idempotency (expires_at);
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
          "room_ws5_sync_json",
          "team_command_metric_configs_json",
          "platform_aggregate_heads",
          "platform_domain_events",
          "race_room_snapshots",
          "task_board_snapshots"
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

/** Test-only: force `persistRaceRoom` to throw (memory and postgres). */
let persistRaceRoomShouldFailForTests = false;

export function setPersistRaceRoomFailureForTests(shouldFail: boolean): void {
  persistRaceRoomShouldFailForTests = shouldFail;
}

export async function persistRaceRoom(room: RaceRoom): Promise<void> {
  if (persistRaceRoomShouldFailForTests) {
    throw new Error("persistRaceRoom forced failure for tests");
  }
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

export async function listPersistedRaceRoomsForMember(userId: string): Promise<RaceRoom[]> {
  if (!pool) {
    return [];
  }
  const result = await pool.query<{ payload: RaceRoom }>(
    `
      SELECT payload
      FROM race_rooms_json r
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements(r.payload->'memberships') m
        WHERE m->>'userId' = $1
      )
      ORDER BY r.updated_at DESC
    `,
    [userId]
  );
  return result.rows.map((r) => r.payload);
}

/**
 * List all rooms that have a non-null `eventEndsAt` field. Used by the chat
 * retention scheduler. Returns a minimal projection so callers don't pay for
 * full payload deserialization on a daily cron.
 */
export async function listPersistedRoomsForRetention(): Promise<
  Array<Pick<RaceRoom, "id" | "eventEndsAt" | "status">>
> {
  if (!pool) {
    return [];
  }
  const result = await pool.query<{ id: string; ends_at: string; status: RaceRoom["status"] }>(
    `
      SELECT
        id,
        payload->>'eventEndsAt' AS ends_at,
        (payload->>'status')::text AS status
      FROM race_rooms_json
      WHERE payload->>'eventEndsAt' IS NOT NULL
    `
  );
  return result.rows
    .filter((r) => typeof r.ends_at === "string" && r.ends_at.length > 0)
    .map((r) => ({ id: r.id, eventEndsAt: r.ends_at, status: r.status }));
}

export async function isJoinCodeTakenInDb(joinCode: string): Promise<boolean> {
  if (!pool) {
    return false;
  }
  const result = await pool.query<{ one: number }>(
    "SELECT 1 AS one FROM race_rooms_json WHERE payload->>'joinCode' = $1 LIMIT 1",
    [joinCode]
  );
  return result.rows.length > 0;
}

export async function loadRoomIdByJoinCode(joinCode: string): Promise<string | undefined> {
  if (!pool) {
    return undefined;
  }
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM race_rooms_json WHERE payload->>'joinCode' = $1 LIMIT 1",
    [joinCode]
  );
  return result.rows[0]?.id;
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

export type PersistedRaceRoomSnapshot = {
  aggregateId: string;
  lastSequence: number;
  payload: ReplayedRaceRoomAggregate;
};

export async function persistRaceRoomSnapshot(snapshot: PersistedRaceRoomSnapshot): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(
    `
      INSERT INTO race_room_snapshots (aggregate_id, last_sequence, payload, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (aggregate_id) DO UPDATE
      SET last_sequence = EXCLUDED.last_sequence,
          payload = EXCLUDED.payload,
          updated_at = NOW();
    `,
    [snapshot.aggregateId, snapshot.lastSequence, JSON.stringify(snapshot.payload)]
  );
}

export async function loadRaceRoomSnapshot(aggregateId: string): Promise<PersistedRaceRoomSnapshot | undefined> {
  if (!pool) {
    return undefined;
  }
  const result = await pool.query<{
    aggregate_id: string;
    last_sequence: number;
    payload: ReplayedRaceRoomAggregate;
  }>(
    "SELECT aggregate_id, last_sequence, payload FROM race_room_snapshots WHERE aggregate_id = $1 LIMIT 1",
    [aggregateId]
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  return {
    aggregateId: row.aggregate_id,
    lastSequence: row.last_sequence,
    payload: row.payload
  };
}

export async function persistTaskBoardPayload(roomId: string, payload: unknown): Promise<void> {
  if (!pool) {
    memoryTaskBoardPayloads.set(roomId, cloneForStorage(payload));
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
    return cloneForStorage(memoryTaskBoardPayloads.get(roomId));
  }
  const result = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM room_task_boards_json WHERE room_id = $1 LIMIT 1",
    [roomId]
  );
  return result.rows[0]?.payload;
}

export async function loadTaskBoardPayloadVersion(roomId: string): Promise<number | undefined> {
  if (!pool) {
    const stored = memoryTaskBoardPayloads.get(roomId);
    if (!stored || typeof stored !== "object") {
      return undefined;
    }
    const version = (stored as { version?: unknown }).version;
    return typeof version === "number" ? version : undefined;
  }
  const result = await pool.query<{ version: number | null }>(
    `
      SELECT CASE
        WHEN jsonb_typeof(payload) = 'object'
          AND payload ? 'version'
          AND jsonb_typeof(payload -> 'version') = 'number'
        THEN (payload ->> 'version')::int
        ELSE NULL
      END AS version
      FROM room_task_boards_json
      WHERE room_id = $1
      LIMIT 1
    `,
    [roomId]
  );
  return result.rows[0]?.version ?? undefined;
}

export async function deleteTaskBoardPayload(roomId: string): Promise<void> {
  if (!pool) {
    memoryTaskBoardPayloads.delete(roomId);
    return;
  }
  await pool.query("DELETE FROM room_task_boards_json WHERE room_id = $1", [roomId]);
}

export type PersistedTaskBoardSnapshot = {
  aggregateId: string;
  version: number;
  payload: unknown;
};

const memoryTaskBoardSnapshots = new Map<string, PersistedTaskBoardSnapshot>();

export async function persistTaskBoardSnapshot(snapshot: PersistedTaskBoardSnapshot): Promise<void> {
  if (!pool) {
    memoryTaskBoardSnapshots.set(snapshot.aggregateId, cloneForStorage(snapshot));
    return;
  }
  await pool.query(
    `
      INSERT INTO task_board_snapshots (aggregate_id, version, payload, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (aggregate_id) DO UPDATE
      SET version = EXCLUDED.version,
          payload = EXCLUDED.payload,
          updated_at = NOW();
    `,
    [snapshot.aggregateId, snapshot.version, JSON.stringify(snapshot.payload)]
  );
}

export async function loadTaskBoardSnapshot(aggregateId: string): Promise<PersistedTaskBoardSnapshot | undefined> {
  if (!pool) {
    return cloneForStorage(memoryTaskBoardSnapshots.get(aggregateId));
  }
  const result = await pool.query<{
    aggregate_id: string;
    version: number;
    payload: unknown;
  }>(
    "SELECT aggregate_id, version, payload FROM task_board_snapshots WHERE aggregate_id = $1 LIMIT 1",
    [aggregateId]
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  return {
    aggregateId: row.aggregate_id,
    version: row.version,
    payload: row.payload
  };
}

export async function deleteTaskBoardSnapshot(aggregateId: string): Promise<void> {
  if (!pool) {
    memoryTaskBoardSnapshots.delete(aggregateId);
    return;
  }
  await pool.query("DELETE FROM task_board_snapshots WHERE aggregate_id = $1", [aggregateId]);
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

export async function persistTeamMetricConfigPayload(teamId: string, payload: unknown): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(
    `
      INSERT INTO team_command_metric_configs_json (team_id, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (team_id) DO UPDATE
      SET payload = EXCLUDED.payload,
          updated_at = NOW();
    `,
    [teamId, JSON.stringify(payload)]
  );
}

export async function loadTeamMetricConfigPayload(teamId: string): Promise<unknown | undefined> {
  if (!pool) {
    return undefined;
  }
  const result = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM team_command_metric_configs_json WHERE team_id = $1 LIMIT 1",
    [teamId]
  );
  return result.rows[0]?.payload;
}

type PlatformEventRow = {
  id: string;
  aggregate_type: PlatformAggregateType;
  aggregate_id: string;
  sequence: number;
  event_type: PlatformEventName;
  occurred_at: Date | string;
  idempotency_key: string;
  payload: unknown;
  schema_version: string;
  transport: TransportChannel;
  actor_user_id: string;
  correlation_id: string | null;
  causation_id: string | null;
};

function platformEventRowToEnvelope(row: PlatformEventRow): PlatformEventEnvelope {
  const occurredAt =
    row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString();
  return {
    id: row.id,
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    eventType: row.event_type,
    occurredAt,
    sequence: row.sequence,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    schemaVersion: row.schema_version,
    transport: row.transport,
    actorUserId: row.actor_user_id,
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    ...(row.causation_id ? { causationId: row.causation_id } : {})
  };
}

export type AppendPersistedPlatformEventInput = {
  aggregateId: string;
  aggregateType: PlatformAggregateType;
  eventType: PlatformEventName;
  idempotencyKey: string;
  normalizedPayload: unknown;
  schemaVersion: string;
  transport: TransportChannel;
  actorUserId: string;
  correlationId?: string;
  causationId?: string;
};

export async function appendPersistedPlatformEvent(
  input: AppendPersistedPlatformEventInput
): Promise<
  | { duplicate: true; conflict?: false; event: PlatformEventEnvelope }
  | { duplicate: false; conflict?: false; event: PlatformEventEnvelope }
  | { duplicate: false; conflict: true; event: PlatformEventEnvelope }
> {
  if (!pool) {
    throw new Error("appendPersistedPlatformEvent requires Postgres persistence");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<PlatformEventRow>(
      `
        SELECT id, aggregate_type, aggregate_id, sequence, event_type, occurred_at, idempotency_key,
               payload, schema_version, transport, actor_user_id, correlation_id, causation_id
        FROM platform_domain_events
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [input.idempotencyKey]
    );
    if (existing.rows[0]) {
      const event = platformEventRowToEnvelope(existing.rows[0]);
      await client.query("COMMIT");
      if (!matchesPlatformEventIdempotencyInput(event, input)) {
        return { duplicate: false, conflict: true, event };
      }
      return { duplicate: true, event };
    }

    const seqResult = await client.query<{ last_sequence: number }>(
      `
        INSERT INTO platform_aggregate_heads (aggregate_type, aggregate_id, last_sequence)
        VALUES ($1, $2, 1)
        ON CONFLICT (aggregate_type, aggregate_id)
        DO UPDATE SET last_sequence = platform_aggregate_heads.last_sequence + 1
        RETURNING last_sequence
      `,
      [input.aggregateType, input.aggregateId]
    );
    const sequence = seqResult.rows[0]!.last_sequence;
    const id = randomUUID();
    const occurredAt = new Date().toISOString();

    await client.query(
      `
        INSERT INTO platform_domain_events (
          id, aggregate_type, aggregate_id, sequence, event_type, occurred_at, idempotency_key,
          payload, schema_version, transport, actor_user_id, correlation_id, causation_id
        ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8::jsonb, $9, $10, $11, $12, $13)
      `,
      [
        id,
        input.aggregateType,
        input.aggregateId,
        sequence,
        input.eventType,
        occurredAt,
        input.idempotencyKey,
        JSON.stringify(input.normalizedPayload),
        input.schemaVersion,
        input.transport,
        input.actorUserId,
        input.correlationId ?? null,
        input.causationId ?? null
      ]
    );
    await client.query("COMMIT");

    const event: PlatformEventEnvelope = {
      id,
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      eventType: input.eventType,
      occurredAt,
      sequence,
      idempotencyKey: input.idempotencyKey,
      payload: input.normalizedPayload,
      schemaVersion: input.schemaVersion,
      transport: input.transport,
      actorUserId: input.actorUserId,
      ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
      ...(input.causationId !== undefined ? { causationId: input.causationId } : {})
    };
    return { duplicate: false, event };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function listPersistedPlatformEventsForAggregate(
  aggregateType: PlatformAggregateType,
  aggregateId: string
): Promise<PlatformEventEnvelope[]> {
  if (!pool) {
    return [];
  }
  const result = await pool.query<PlatformEventRow>(
    `
      SELECT id, aggregate_type, aggregate_id, sequence, event_type, occurred_at, idempotency_key,
             payload, schema_version, transport, actor_user_id, correlation_id, causation_id
      FROM platform_domain_events
      WHERE aggregate_type = $1 AND aggregate_id = $2
      ORDER BY sequence ASC
    `,
    [aggregateType, aggregateId]
  );
  return result.rows.map(platformEventRowToEnvelope);
}

export async function resetPersistedPlatformEventsForTests(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query("TRUNCATE TABLE race_room_snapshots");
  await pool.query("TRUNCATE TABLE platform_domain_events");
  await pool.query("TRUNCATE TABLE platform_aggregate_heads");
}
