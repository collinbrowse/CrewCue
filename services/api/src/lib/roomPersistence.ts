import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  PlatformAggregateType,
  PlatformEventEnvelope,
  PlatformEventName,
  RaceRoom,
  RaceRoomEntitlementStatus,
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
// allowExitOnIdle (here and on the other stores' pools): an idle connection does not keep the process
// alive. The server stays up on its listening socket. Without it every test file that touched
// Postgres waited out pg's 10 s idle timeout before exiting, which was 10 of test:pg's 11 minutes.
const pool = PERSISTENCE_MODE === "postgres" ? new Pool({ connectionString: DATABASE_URL, allowExitOnIdle: true }) : null;

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

/**
 * Where a query runs: the pool, or the client of a transaction the caller holds open (a query
 * that must see, or must not wait behind, that transaction's locks).
 */
export type PersistenceQueryable = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

export function getRoomPersistenceMode(): PersistenceMode {
  return PERSISTENCE_MODE;
}

export function validateRoomPersistenceEnv(): void {
  if (PERSISTENCE_MODE === "postgres" && !DATABASE_URL) {
    throw new Error("PERSISTENCE_MODE=postgres requires DATABASE_URL.");
  }
}

/** Mirrors db/migrations/0015_room_athlete_pings.sql. */
const ROOM_ATHLETE_PINGS_DDL = `
  CREATE TABLE IF NOT EXISTS room_athlete_pings (
    room_id TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy_m DOUBLE PRECISION,
    received_at TIMESTAMPTZ NOT NULL,
    ping_id TEXT NOT NULL,
    PRIMARY KEY (room_id, recorded_at)
  );
`;

/** Mirrors db/migrations/0016_finished_efforts.sql (see finishedEffortStore.ts). */
const FINISHED_EFFORTS_DDL = `
  CREATE TABLE IF NOT EXISTS finished_efforts (
    room_id TEXT PRIMARY KEY,
    athlete_user_id TEXT NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS finished_efforts_by_athlete ON finished_efforts (athlete_user_id);
`;

/** Mirrors db/migrations/0017_course_history.sql (see courseHistory/store.ts). */
const COURSE_HISTORY_DDL = `
  CREATE TABLE IF NOT EXISTS course_history_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    usage TEXT NOT NULL CHECK (usage IN ('product', 'backtest_only')),
    name TEXT NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL,
    UNIQUE (source, source_event_id)
  );
  CREATE INDEX IF NOT EXISTS course_history_events_by_usage ON course_history_events (usage);
`;

/**
 * Mirrors db/migrations/0020_tracking_reminders_sent.sql (see trackingReminderScheduler.ts).
 * Runs after race_rooms_json exists: the claim rows reference it.
 */
const TRACKING_REMINDERS_DDL = `
  CREATE TABLE IF NOT EXISTS tracking_reminders_sent (
    room_id TEXT NOT NULL REFERENCES race_rooms_json (id) ON DELETE CASCADE,
    slot TEXT NOT NULL CHECK (slot IN ('t45', 't5')),
    race_start_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (room_id, slot, race_start_at)
  );
  CREATE INDEX IF NOT EXISTS race_rooms_json_race_start_at
    ON race_rooms_json ((payload->>'raceStartAt') COLLATE "C");
`;

/**
 * Mirrors db/migrations/0021_unpaid_race_rooms.sql: two partial indexes over unpaid rooms only.
 * The unpaid race sweeper reads a range of the first (by creation time); the unpaid race limit
 * reads the caller's entries of the second (by creator, spelled as `raceCreatorOf` reads it), so
 * neither reads any other room's payload. Queries must spell the predicate and the expressions
 * exactly as below, `'unpaid'` as a literal (not a bind parameter), or Postgres can't prove the
 * partial index applies.
 */
const UNPAID_RACE_ROOMS_DDL = `
  CREATE INDEX IF NOT EXISTS race_rooms_json_unpaid_created_at
    ON race_rooms_json ((payload->>'createdAt') COLLATE "C")
    WHERE payload->'entitlement'->>'status' = 'unpaid';
  CREATE INDEX IF NOT EXISTS race_rooms_json_unpaid_creator
    ON race_rooms_json ((COALESCE(payload->>'createdByUserId', payload->'memberships'->0->>'userId')))
    WHERE payload->'entitlement'->>'status' = 'unpaid';
`;

/** Mirrors db/migrations/0022_room_removed_members.sql (see roomRemovalStore.ts). */
const ROOM_REMOVED_MEMBERS_DDL = `
  CREATE TABLE IF NOT EXISTS room_removed_members (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    removed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS room_removed_members_by_user ON room_removed_members (user_id);
`;

/** Mirrors db/migrations/0024_room_removed_member_hashes.sql (see roomRemovalStore.ts). */
const ROOM_REMOVED_MEMBER_HASHES_DDL = `
  CREATE TABLE IF NOT EXISTS room_removed_member_hashes (
    room_id TEXT NOT NULL,
    user_hash TEXT NOT NULL,
    removed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (room_id, user_hash)
  );
`;

/**
 * Mirrors db/migrations/0023_unpaid_reminders_sent.sql (see unpaidRaceReminderScheduler.ts): the
 * reminder claims, and a partial index of unpaid rooms by race start for the `race_soon` listing.
 * Runs after race_rooms_json exists: the claim rows reference it.
 */
const UNPAID_REMINDERS_DDL = `
  CREATE TABLE IF NOT EXISTS unpaid_reminders_sent (
    room_id TEXT NOT NULL REFERENCES race_rooms_json (id) ON DELETE CASCADE,
    slot TEXT NOT NULL CHECK (slot IN ('expiry_7d', 'expiry_1d', 'race_soon')),
    claimed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (room_id, slot)
  );
  CREATE INDEX IF NOT EXISTS race_rooms_json_unpaid_race_start_at
    ON race_rooms_json ((payload->>'raceStartAt') COLLATE "C")
    WHERE payload->'entitlement'->>'status' = 'unpaid';
`;

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
    await client.query(ROOM_ATHLETE_PINGS_DDL);
    await client.query(FINISHED_EFFORTS_DDL);
    await client.query(COURSE_HISTORY_DDL);
    await client.query(TRACKING_REMINDERS_DDL);
    await client.query(UNPAID_RACE_ROOMS_DDL);
    await client.query(ROOM_REMOVED_MEMBERS_DDL);
    await client.query(ROOM_REMOVED_MEMBER_HASHES_DDL);
    await client.query(UNPAID_REMINDERS_DDL);
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
          "task_board_snapshots",
          "room_athlete_pings",
          "finished_efforts",
          "course_history_events",
          "tracking_reminders_sent",
          "room_removed_members",
          "room_removed_member_hashes",
          "unpaid_reminders_sent"
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
/** Test-only: observe or stall a room write before it hits Postgres. */
let persistRaceRoomBeforeWriteForTests: ((room: RaceRoom) => Promise<void>) | undefined;

export function setPersistRaceRoomFailureForTests(shouldFail: boolean): void {
  persistRaceRoomShouldFailForTests = shouldFail;
}

export function setPersistRaceRoomBeforeWriteForTests(
  hook: ((room: RaceRoom) => Promise<void>) | undefined
): void {
  persistRaceRoomBeforeWriteForTests = hook;
}

export async function persistRaceRoom(room: RaceRoom): Promise<void> {
  if (persistRaceRoomBeforeWriteForTests) {
    await persistRaceRoomBeforeWriteForTests(room);
  }
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

/** The room fields the tracking reminder scheduler reads. */
export type RaceRoomStartFields = Pick<
  RaceRoom,
  "id" | "athleteId" | "status" | "raceStartAt" | "entitlement" | "memberships"
>;

/**
 * Rooms whose stored `raceStartAt` string is after `fromIso` and at most `toIso`, compared as
 * bytes (`COLLATE "C"`, the `race_rooms_json_race_start_at` index). A prefilter: ISO-8601 UTC
 * strings sort by time to the second, so callers widen the range and check the parsed time.
 *
 * Only the scheduler's fields leave the database: a payload can carry the course GPX (MBs), the
 * route overlay and the map workspace, and this runs every minute on every instance.
 * `jsonb_to_record` reads the payload once per row instead of once per field.
 */
export async function listPersistedRaceRoomsStartingBetween(
  fromIso: string,
  toIso: string
): Promise<RaceRoomStartFields[]> {
  if (!pool) {
    return [];
  }
  const result = await pool.query<{
    id: string;
    athleteId: string;
    status: RaceRoom["status"];
    raceStartAt: string | null;
    entitlement: RaceRoom["entitlement"];
    memberships: RaceRoom["memberships"];
  }>(
    `
      SELECT r.id, f."athleteId", f.status, f."raceStartAt", f.entitlement, f.memberships
      FROM race_rooms_json r
      CROSS JOIN LATERAL jsonb_to_record(r.payload) AS f(
        "athleteId" text,
        status text,
        "raceStartAt" text,
        entitlement jsonb,
        memberships jsonb
      )
      WHERE r.payload->>'raceStartAt' > $1::text COLLATE "C"
        AND r.payload->>'raceStartAt' <= $2::text COLLATE "C"
    `,
    [fromIso, toIso]
  );
  return result.rows.map((row) => ({
    id: row.id,
    athleteId: row.athleteId,
    status: row.status,
    ...(row.raceStartAt !== null ? { raceStartAt: row.raceStartAt } : {}),
    entitlement: row.entitlement,
    memberships: row.memberships
  }));
}

/**
 * The room fields the unpaid race sweeper reads. Either may be missing on a malformed payload;
 * the sweeper then keeps the room.
 */
export type RaceRoomExpiryFields = {
  id: string;
  entitlementStatus: RaceRoomEntitlementStatus | undefined;
  createdAt: string | undefined;
  /**
   * The creator (`createdByUserId`, else the first member, as `raceCreatorOf` reads it). The
   * stored room the delete condition is asked about always carries it when there is one; the
   * sweeper keeps a race whose creator has an unattached billing grant (R25).
   */
  creatorId?: string;
};

/**
 * SQL: the room's creator, as `raceCreatorOf` reads it (`createdByUserId`, else the first member),
 * for a query over `race_rooms_json` aliased `room`.
 */
function creatorIdSql(room: string): string {
  return `COALESCE(${room}.payload->>'createdByUserId', ${room}.payload->'memberships'->0->>'userId')`;
}

/**
 * SQL: whether the room's creator bought a pass the webhook stored with no room (`billing_grants`
 * with `room_id` NULL and the creator's `app_user_id`, active or revoked: risk R25, billingStore.ts
 * `listUserIdsWithUnattachedBillingGrants`). The unpaid-race reminders and the sweeper leave such a
 * creator's races alone. For a query over `race_rooms_json` aliased `room`.
 */
export function creatorHasUnattachedGrantSql(room: string): string {
  return `EXISTS (
    SELECT 1 FROM billing_grants unattached
    WHERE unattached.room_id IS NULL AND unattached.app_user_id = ${creatorIdSql(room)}
  )`;
}

/**
 * Unpaid rooms whose stored `createdAt` string is before `beforeIso`, compared as bytes, oldest
 * first, at most `limit`: a range of the `race_rooms_json_unpaid_created_at` partial index. A
 * prefilter like `listPersistedRaceRoomsStartingBetween`: callers widen the range and check the
 * parsed time. Only the sweeper's three fields leave the database, never the payload (course GPX).
 *
 * Rooms with a billing grant, active or revoked, are left out: they were paid once (a refund puts
 * a race back to `unpaid`), and the sweeper never deletes them, so listing them would let them
 * fill every batch ahead of the races it does delete. So are rooms whose creator has an
 * unattached grant (R25: a purchase the webhook could not attach, so maybe a paying runner), and
 * rooms whose `expiry_1d` reminder was not claimed at or before `finalReminderClaimedBeforeIso`
 * (`unpaid_reminders_sent`): the sweeper waits 24 hours after that warning, and those rooms would
 * fill the batch the same way. Needs the `billing_grants` table (migration 0019; callers run the
 * billing store's `ensureBillingStoreReady` first).
 */
export async function listPersistedUnpaidRaceRoomsCreatedBefore(
  beforeIso: string,
  limit: number,
  finalReminderClaimedBeforeIso: string
): Promise<RaceRoomExpiryFields[]> {
  if (!pool) {
    return [];
  }
  const result = await pool.query<{
    id: string;
    entitlement_status: RaceRoomEntitlementStatus | null;
    created_at: string | null;
    creator_id: string | null;
  }>(
    `
      SELECT id,
             payload->'entitlement'->>'status' AS entitlement_status,
             payload->>'createdAt' AS created_at,
             ${creatorIdSql("race_rooms_json")} AS creator_id
      FROM race_rooms_json
      WHERE payload->'entitlement'->>'status' = 'unpaid'
        AND payload->>'createdAt' < $1::text COLLATE "C"
        AND NOT EXISTS (SELECT 1 FROM billing_grants WHERE billing_grants.room_id = race_rooms_json.id)
        AND NOT ${creatorHasUnattachedGrantSql("race_rooms_json")}
        AND EXISTS (
          SELECT 1 FROM unpaid_reminders_sent
          WHERE unpaid_reminders_sent.room_id = race_rooms_json.id
            AND unpaid_reminders_sent.slot = 'expiry_1d'
            AND unpaid_reminders_sent.claimed_at <= $3::timestamptz
        )
      ORDER BY (payload->>'createdAt') COLLATE "C" ASC
      LIMIT $2
    `,
    [beforeIso, limit, finalReminderClaimedBeforeIso]
  );
  return result.rows.map((row) => ({
    id: row.id,
    entitlementStatus: row.entitlement_status ?? undefined,
    createdAt: row.created_at ?? undefined,
    ...(row.creator_id !== null ? { creatorId: row.creator_id } : {})
  }));
}

/** Unpaid-race reminder slots (unpaidRaceReminderScheduler.ts), as `unpaid_reminders_sent.slot` stores them. */
export type UnpaidReminderSlot = "expiry_7d" | "expiry_1d" | "race_soon";

/**
 * The room fields the unpaid-race reminder scheduler reads. Times and the name may be missing on
 * a malformed payload; the scheduler then sends nothing that needs them.
 */
export type RaceRoomReminderFields = {
  id: string;
  entitlementStatus: RaceRoomEntitlementStatus | undefined;
  createdAt: string | undefined;
  raceStartAt: string | undefined;
  /** Who gets the push: `createdByUserId`, else the first member (billingEntitlement.ts `raceCreatorOf`). */
  creatorId: string | undefined;
  /** Whether the creator is still on the roster. A creator who left gets the claim, not the push. */
  creatorIsMember: boolean;
  name: string | undefined;
  /** The room's reminder claims so far (slot → ISO claim time), so a tick skips them without a write. */
  claims: Partial<Record<UnpaidReminderSlot, string>>;
};

/**
 * The reminder listing's columns: the scheduler's fields only, read from the payload once per row
 * (`jsonb_to_record`), never the payload itself (it can carry the course GPX), and the room's
 * claims. The creator is spelled as `raceCreatorOf` reads it.
 */
const REMINDER_FIELDS_SELECT = `
  SELECT r.id,
         f.entitlement->>'status' AS entitlement_status,
         f."createdAt" AS created_at,
         f."raceStartAt" AS race_start_at,
         COALESCE(f."createdByUserId", f.memberships->0->>'userId') AS creator_id,
         COALESCE(
           jsonb_typeof(f.memberships) = 'array'
             AND f.memberships @> jsonb_build_array(
               jsonb_build_object('userId', COALESCE(f."createdByUserId", f.memberships->0->>'userId'))
             ),
           false
         ) AS creator_is_member,
         f."name" AS name,
         (SELECT jsonb_object_agg(s.slot, s.claimed_at) FROM unpaid_reminders_sent s WHERE s.room_id = r.id) AS claims
  FROM race_rooms_json r
  CROSS JOIN LATERAL jsonb_to_record(r.payload) AS f(
    "createdAt" text,
    "raceStartAt" text,
    "createdByUserId" text,
    "name" text,
    entitlement jsonb,
    memberships jsonb
  )
`;

type ReminderFieldsRow = {
  id: string;
  entitlement_status: RaceRoomEntitlementStatus | null;
  created_at: string | null;
  race_start_at: string | null;
  creator_id: string | null;
  creator_is_member: boolean;
  name: string | null;
  claims: Record<string, string> | null;
};

const UNPAID_REMINDER_SLOTS: readonly UnpaidReminderSlot[] = ["expiry_7d", "expiry_1d", "race_soon"];

function reminderFieldsOf(row: ReminderFieldsRow): RaceRoomReminderFields {
  const claims: Partial<Record<UnpaidReminderSlot, string>> = {};
  for (const slot of UNPAID_REMINDER_SLOTS) {
    const at = Date.parse(row.claims?.[slot] ?? "");
    if (Number.isFinite(at)) {
      claims[slot] = new Date(at).toISOString();
    }
  }
  return {
    id: row.id,
    entitlementStatus: row.entitlement_status ?? undefined,
    createdAt: row.created_at ?? undefined,
    raceStartAt: row.race_start_at ?? undefined,
    creatorId: row.creator_id ?? undefined,
    creatorIsMember: row.creator_is_member === true,
    name: row.name ?? undefined,
    claims
  };
}

/**
 * The unpaid-race reminder scheduler's candidates, never paid (no billing grant, active or
 * revoked) and whose creator has no unattached grant (R25), from two index ranges, each a prefilter on stored strings compared as bytes (callers
 * widen them and check the parsed times):
 *
 * - created before `createdBeforeIso` (the `race_rooms_json_unpaid_created_at` partial index) and
 *   without an `expiry_1d` claim (a room with one has no expiry reminder left), oldest first;
 * - starting after `startsAfterIso` and at most `startsAtOrBeforeIso` (the
 *   `race_rooms_json_unpaid_race_start_at` partial index) without a `race_soon` claim.
 *
 * A room in both comes back once. Both read unpaid rooms only, so no paid room's payload is read.
 * Needs the `billing_grants` table (migration 0019; callers run `ensureBillingStoreReady` first).
 */
export async function listPersistedUnpaidRaceRoomsForReminders(
  createdBeforeIso: string,
  startsAfterIso: string,
  startsAtOrBeforeIso: string
): Promise<RaceRoomReminderFields[]> {
  if (!pool) {
    return [];
  }
  const byCreation = await pool.query<ReminderFieldsRow>(
    `${REMINDER_FIELDS_SELECT}
      WHERE r.payload->'entitlement'->>'status' = 'unpaid'
        AND r.payload->>'createdAt' < $1::text COLLATE "C"
        AND NOT EXISTS (SELECT 1 FROM billing_grants g WHERE g.room_id = r.id)
        AND NOT ${creatorHasUnattachedGrantSql("r")}
        AND NOT EXISTS (SELECT 1 FROM unpaid_reminders_sent s WHERE s.room_id = r.id AND s.slot = 'expiry_1d')
      ORDER BY (r.payload->>'createdAt') COLLATE "C" ASC
    `,
    [createdBeforeIso]
  );
  const byStart = await pool.query<ReminderFieldsRow>(
    `${REMINDER_FIELDS_SELECT}
      WHERE r.payload->'entitlement'->>'status' = 'unpaid'
        AND r.payload->>'raceStartAt' > $1::text COLLATE "C"
        AND r.payload->>'raceStartAt' <= $2::text COLLATE "C"
        AND NOT EXISTS (SELECT 1 FROM billing_grants g WHERE g.room_id = r.id)
        AND NOT ${creatorHasUnattachedGrantSql("r")}
        AND NOT EXISTS (SELECT 1 FROM unpaid_reminders_sent s WHERE s.room_id = r.id AND s.slot = 'race_soon')
    `,
    [startsAfterIso, startsAtOrBeforeIso]
  );
  const byId = new Map<string, RaceRoomReminderFields>();
  for (const row of [...byCreation.rows, ...byStart.rows]) {
    if (!byId.has(row.id)) {
      byId.set(row.id, reminderFieldsOf(row));
    }
  }
  return [...byId.values()];
}

/**
 * How many stored rooms `userId` created that are still `unpaid` and were never paid (the unpaid
 * race limit). The creator is `createdByUserId`, else the first member (rooms from before #649),
 * as `raceCreatorOf` reads it: the `race_rooms_json_unpaid_creator` partial index, so only the
 * caller's own unpaid rows are read. A room with a billing grant, a refunded one included, was
 * paid once and doesn't count. Needs the `billing_grants` table (migration 0019; callers run the
 * billing store's `ensureBillingStoreReady` first).
 */
export async function countPersistedUnpaidRaceRoomsCreatedBy(userId: string): Promise<number> {
  if (!pool) {
    return 0;
  }
  const result = await pool.query<{ unpaid: string }>(
    `
      SELECT count(*) AS unpaid
      FROM race_rooms_json
      WHERE payload->'entitlement'->>'status' = 'unpaid'
        AND COALESCE(payload->>'createdByUserId', payload->'memberships'->0->>'userId') = $1
        AND NOT EXISTS (SELECT 1 FROM billing_grants WHERE billing_grants.room_id = race_rooms_json.id)
    `,
    [userId]
  );
  return Number(result.rows[0]?.unpaid ?? 0);
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

export async function loadRaceRoomInvitesForRoom(roomId: string): Promise<RaceRoomInvite[]> {
  if (!pool) {
    return [];
  }
  const result = await pool.query<{ payload: RaceRoomInvite }>(
    "SELECT payload FROM race_room_invites_json WHERE room_id = $1",
    [roomId]
  );
  return result.rows.map((row) => row.payload);
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

/**
 * What a room delete did. `deleted`: this call removed the room row. `kept`: the caller's
 * condition said no, and nothing changed. `gone`: there was no room row (already deleted).
 */
export type PersistedRaceRoomDeletion = "deleted" | "kept" | "gone";

/**
 * A conditional room delete's question, asked of the stored row while it is locked. `db` is the
 * locking transaction's client: a condition that reads more (billing grants) reads it there, so it
 * never waits for a second pool connection while holding the lock (writers queued on that lock can
 * fill the pool, and Postgres can't see that wait as a deadlock).
 */
export type PersistedRaceRoomDeleteCondition = (
  room: RaceRoomExpiryFields,
  db: PersistenceQueryable
) => boolean | Promise<boolean>;

/** The room's sweeper fields, read and locked `FOR UPDATE` inside `client`'s transaction; undefined when there is no row. */
async function lockRaceRoomExpiryFields(client: PoolClient, roomId: string): Promise<RaceRoomExpiryFields | undefined> {
  const locked = await client.query<{
    entitlement_status: RaceRoomEntitlementStatus | null;
    created_at: string | null;
    creator_id: string | null;
  }>(
    `
      SELECT payload->'entitlement'->>'status' AS entitlement_status,
             payload->>'createdAt' AS created_at,
             ${creatorIdSql("race_rooms_json")} AS creator_id
      FROM race_rooms_json
      WHERE id = $1
      FOR UPDATE
    `,
    [roomId]
  );
  const row = locked.rows[0];
  if (!row) {
    return undefined;
  }
  return {
    id: roomId,
    entitlementStatus: row.entitlement_status ?? undefined,
    createdAt: row.created_at ?? undefined,
    ...(row.creator_id !== null ? { creatorId: row.creator_id } : {})
  };
}

/**
 * Ask `onlyIf` about the stored room row under its row lock, then release it, changing nothing:
 * `deleted` when it says yes (the room may be deleted), `kept` when it says no, `gone` when there
 * is no row. `deleteRaceRoomAndData` asks this before it removes the room's data kept outside these
 * tables, and `deletePersistedRaceRoomRows` asks again as it deletes the row.
 *
 * Memory mode keeps no rows: it returns `gone`, and the caller decides from its in-process maps.
 */
export async function checkPersistedRaceRoomDeleteCondition(
  roomId: string,
  onlyIf: PersistedRaceRoomDeleteCondition
): Promise<PersistedRaceRoomDeletion> {
  if (!pool) {
    return "gone";
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fields = await lockRaceRoomExpiryFields(client, roomId);
    const result = !fields ? "gone" : (await onlyIf(fields, client)) ? "deleted" : "kept";
    await client.query("ROLLBACK");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Room deletion (account deletion, the unpaid race sweeper): remove every durable row keyed by
 * this room, in one transaction. Covers the room document, invites, task board, WS2/WS4/WS5
 * payloads, snapshots, the platform event log for the room aggregate, and the athlete ping track
 * (tracking reminder claims go with the room row, ON DELETE CASCADE).
 *
 * With `onlyIf`, the stored row is read and locked (`FOR UPDATE`) first, and nothing is deleted
 * unless `onlyIf` returns true for it, asked on this transaction's client. A write from another
 * instance waits on that lock, so the condition holds for the row the delete removes (that
 * instance's whole-document upsert can still re-create the row after the commit from its stale
 * cache: R1). Without `onlyIf` the delete is unconditional, and dependent rows go even when the
 * room row is already gone.
 *
 * Memory mode keeps no rows: it returns `gone`, and the caller decides from its in-process maps.
 */
export async function deletePersistedRaceRoomRows(
  roomId: string,
  onlyIf?: PersistedRaceRoomDeleteCondition
): Promise<PersistedRaceRoomDeletion> {
  if (!pool) {
    return "gone";
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (onlyIf) {
      const fields = await lockRaceRoomExpiryFields(client, roomId);
      if (!fields) {
        await client.query("ROLLBACK");
        return "gone";
      }
      if (!(await onlyIf(fields, client))) {
        await client.query("ROLLBACK");
        return "kept";
      }
    }
    await client.query("DELETE FROM race_room_invites_json WHERE room_id = $1", [roomId]);
    await client.query("DELETE FROM room_task_boards_json WHERE room_id = $1", [roomId]);
    await client.query("DELETE FROM room_ws2_runtime_json WHERE room_id = $1", [roomId]);
    await client.query("DELETE FROM room_ws4_adaptive_json WHERE room_id = $1", [roomId]);
    await client.query("DELETE FROM room_ws5_sync_json WHERE room_id = $1", [roomId]);
    await client.query("DELETE FROM race_room_snapshots WHERE aggregate_id = $1", [roomId]);
    await client.query("DELETE FROM task_board_snapshots WHERE aggregate_id = $1", [roomId]);
    await client.query("DELETE FROM platform_domain_events WHERE aggregate_id = $1", [roomId]);
    await client.query("DELETE FROM platform_aggregate_heads WHERE aggregate_id = $1", [roomId]);
    await client.query("DELETE FROM room_athlete_pings WHERE room_id = $1", [roomId]);
    const room = await client.query("DELETE FROM race_rooms_json WHERE id = $1", [roomId]);
    await client.query("COMMIT");
    return room.rowCount === 1 ? "deleted" : "gone";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Account deletion: re-attribute a deleted user's events in rooms that survive them. */
export async function anonymizePersistedPlatformEventActor(actorUserId: string, replacement: string): Promise<number> {
  if (!pool) {
    return 0;
  }
  const result = await pool.query("UPDATE platform_domain_events SET actor_user_id = $2 WHERE actor_user_id = $1", [
    actorUserId,
    replacement
  ]);
  return result.rowCount ?? 0;
}

export async function deletePersistedRaceRoomInvite(token: string): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query("DELETE FROM race_room_invites_json WHERE token = $1", [token]);
}

/** Account deletion: rooms whose runner is this user, whether or not they are on the roster. */
export async function listPersistedRaceRoomsForAthlete(userId: string): Promise<RaceRoom[]> {
  if (!pool) {
    return [];
  }
  const result = await pool.query<{ payload: RaceRoom }>(
    "SELECT payload FROM race_rooms_json WHERE payload->>'athleteId' = $1",
    [userId]
  );
  return result.rows.map((r) => r.payload);
}
