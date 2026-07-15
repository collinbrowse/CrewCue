/**
 * Chat persistence: notification preferences and push devices.
 * Crew chat MVP plaintext — no identity/backup/envelope crypto tables.
 */
import { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  ChatNotificationPref,
  ChatNotificationPrefRecord,
  ChatPushDeviceRecord,
  ChatPushPlatform,
  ChatRetentionResult
} from "@crewcue/contracts";

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

const memoryPrefs = new Map<string, ChatNotificationPrefRecord>();
const memoryPushDevices = new Map<string, ChatPushDeviceRecord>();

function prefKey(userId: string, roomId: string): string {
  return `${userId}|${roomId}`;
}

export function isChatPersistencePostgres(): boolean {
  return pool !== null;
}

export async function initChatPersistence(log: FastifyBaseLogger): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }
  initPromise = (async () => {
    if (initialized) return;
    if (!pool) {
      initialized = true;
      log.info({ chatPersistence: { mode: MODE } }, "chat_persistence_ready");
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(711200)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_push_devices (
          device_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          token TEXT NOT NULL,
          registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS chat_push_devices_user
        ON chat_push_devices (user_id);
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_notification_prefs (
          user_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          preference TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, room_id)
        );
      `);
    } finally {
      await client.query("SELECT pg_advisory_unlock(711200)");
      client.release();
    }
    initialized = true;
    log.info({ chatPersistence: { mode: MODE } }, "chat_persistence_ready");
  })();
  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

const CHAT_PERSISTENCE_NOOP_LOGGER = {
  info: () => {
    // no-op
  }
} as unknown as FastifyBaseLogger;

async function ensureChatPersistenceReady(): Promise<void> {
  if (!pool || initialized) {
    return;
  }
  await initChatPersistence(CHAT_PERSISTENCE_NOOP_LOGGER);
}

export async function setChatNotificationPref(record: ChatNotificationPrefRecord): Promise<void> {
  if (!pool) {
    memoryPrefs.set(prefKey(record.userId, record.roomId), structuredClone(record));
    return;
  }
  await pool.query(
    `
      INSERT INTO chat_notification_prefs (user_id, room_id, preference, updated_at)
      VALUES ($1, $2, $3, $4::timestamptz)
      ON CONFLICT (user_id, room_id) DO UPDATE
      SET preference = EXCLUDED.preference,
          updated_at = EXCLUDED.updated_at;
    `,
    [record.userId, record.roomId, record.preference, record.updatedAt]
  );
}

export async function getChatNotificationPref(
  userId: string,
  roomId: string
): Promise<ChatNotificationPrefRecord | undefined> {
  if (!pool) {
    return memoryPrefs.get(prefKey(userId, roomId));
  }
  const result = await pool.query<{
    user_id: string;
    room_id: string;
    preference: ChatNotificationPref;
    updated_at: Date | string;
  }>(
    "SELECT user_id, room_id, preference, updated_at FROM chat_notification_prefs WHERE user_id = $1 AND room_id = $2",
    [userId, roomId]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    userId: row.user_id,
    roomId: row.room_id,
    preference: row.preference,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString()
  };
}

export async function listChatNotificationPrefsForUsers(
  userIds: readonly string[],
  roomId: string
): Promise<ChatNotificationPrefRecord[]> {
  const out: ChatNotificationPrefRecord[] = [];
  for (const id of userIds) {
    const pref = await getChatNotificationPref(id, roomId);
    if (pref) {
      out.push(pref);
    }
  }
  return out;
}

export async function upsertChatPushDevice(record: ChatPushDeviceRecord): Promise<void> {
  if (!pool) {
    memoryPushDevices.set(record.deviceId, structuredClone(record));
    return;
  }
  await pool.query(
    `
      INSERT INTO chat_push_devices (device_id, user_id, platform, token, registered_at)
      VALUES ($1, $2, $3, $4, $5::timestamptz)
      ON CONFLICT (device_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          platform = EXCLUDED.platform,
          token = EXCLUDED.token,
          registered_at = EXCLUDED.registered_at;
    `,
    [record.deviceId, record.userId, record.platform, record.token, record.registeredAt]
  );
}

/** @deprecated alias */
export const upsertChatPushToken = upsertChatPushDevice;

export async function listChatPushDevicesForUsers(
  userIds: readonly string[]
): Promise<ChatPushDeviceRecord[]> {
  if (!pool) {
    return Array.from(memoryPushDevices.values()).filter((t) => userIds.includes(t.userId));
  }
  if (userIds.length === 0) return [];
  const result = await pool.query<{
    device_id: string;
    user_id: string;
    platform: ChatPushPlatform;
    token: string;
    registered_at: Date | string;
  }>(
    `
      SELECT device_id, user_id, platform, token, registered_at
      FROM chat_push_devices
      WHERE user_id = ANY($1::text[])
    `,
    [userIds]
  );
  return result.rows.map((row) => ({
    deviceId: row.device_id,
    userId: row.user_id,
    platform: row.platform,
    token: row.token,
    registeredAt:
      row.registered_at instanceof Date
        ? row.registered_at.toISOString()
        : new Date(row.registered_at).toISOString()
  }));
}

/** @deprecated alias */
export const listChatPushTokensForUsers = listChatPushDevicesForUsers;

export async function deleteChatRoomData(roomId: string): Promise<ChatRetentionResult> {
  if (!pool) {
    let prefsPurged = 0;
    for (const key of Array.from(memoryPrefs.keys())) {
      if (key.endsWith(`|${roomId}`)) {
        memoryPrefs.delete(key);
        prefsPurged += 1;
      }
    }
    return {
      roomId,
      deletedAt: new Date().toISOString(),
      prefsPurged,
      pushTokensPurged: 0
    };
  }
  await ensureChatPersistenceReady();
  const prefs = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM chat_notification_prefs WHERE room_id = $1",
    [roomId]
  );
  await pool.query("DELETE FROM chat_notification_prefs WHERE room_id = $1", [roomId]);
  return {
    roomId,
    deletedAt: new Date().toISOString(),
    prefsPurged: Number.parseInt(prefs.rows[0]?.count ?? "0", 10),
    pushTokensPurged: 0
  };
}

/** Test-only: clear all in-memory state. No-op against postgres. */
export function _resetChatPersistenceForTests(): void {
  if (pool) return;
  memoryPrefs.clear();
  memoryPushDevices.clear();
}
