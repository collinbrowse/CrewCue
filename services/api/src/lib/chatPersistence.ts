/**
 * Chat persistence: notification preferences and push devices.
 * Messages live in chatMessageStore.ts; photos in chatPhotoStore.ts (ADR 0011).
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
import { deleteChatMessagesBySender, deleteChatMessagesForRoom } from "./chatMessageStore.js";
import { chatPhotoStore } from "./chatPhotoStore.js";

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
      await client.query("ALTER TABLE chat_push_devices ADD COLUMN IF NOT EXISTS apns_environment TEXT;");
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
    for (const [id, existing] of memoryPushDevices) {
      if (existing.token === record.token && id !== record.deviceId) memoryPushDevices.delete(id);
    }
    memoryPushDevices.set(record.deviceId, structuredClone(record));
    return;
  }
  await ensureChatPersistenceReady();
  // A token belongs to one device: drop any other row (another user signed in on the same phone).
  await pool.query("DELETE FROM chat_push_devices WHERE token = $1 AND device_id <> $2", [
    record.token,
    record.deviceId
  ]);
  await pool.query(
    `
      INSERT INTO chat_push_devices (device_id, user_id, platform, token, registered_at, apns_environment)
      VALUES ($1, $2, $3, $4, $5::timestamptz, $6)
      ON CONFLICT (device_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          platform = EXCLUDED.platform,
          token = EXCLUDED.token,
          registered_at = EXCLUDED.registered_at,
          apns_environment = EXCLUDED.apns_environment;
    `,
    [
      record.deviceId,
      record.userId,
      record.platform,
      record.token,
      record.registeredAt,
      record.apnsEnvironment ?? null
    ]
  );
}

/** Deletes devices whose push token the provider rejected. */
export async function deleteChatPushDevices(deviceIds: readonly string[]): Promise<number> {
  if (deviceIds.length === 0) return 0;
  if (!pool) {
    let deleted = 0;
    for (const id of deviceIds) if (memoryPushDevices.delete(id)) deleted += 1;
    return deleted;
  }
  await ensureChatPersistenceReady();
  const result = await pool.query("DELETE FROM chat_push_devices WHERE device_id = ANY($1::text[])", [
    deviceIds
  ]);
  return result.rowCount ?? 0;
}

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
    apns_environment: "development" | "production" | null;
  }>(
    `
      SELECT device_id, user_id, platform, token, registered_at, apns_environment
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
        : new Date(row.registered_at).toISOString(),
    ...(row.apns_environment ? { apnsEnvironment: row.apns_environment } : {})
  }));
}

/** Deletes a room's chat: messages, their photos, and notification prefs. */
export async function deleteChatRoomData(roomId: string): Promise<ChatRetentionResult> {
  const { messagesPurged, photoKeys } = await deleteChatMessagesForRoom(roomId);
  const store = chatPhotoStore();
  const photosPurged = store && photoKeys.length ? await store.delete(photoKeys) : 0;
  let prefsPurged = 0;
  if (!pool) {
    for (const key of Array.from(memoryPrefs.keys())) {
      if (key.endsWith(`|${roomId}`)) {
        memoryPrefs.delete(key);
        prefsPurged += 1;
      }
    }
  } else {
    await ensureChatPersistenceReady();
    const prefs = await pool.query("DELETE FROM chat_notification_prefs WHERE room_id = $1", [roomId]);
    prefsPurged = prefs.rowCount ?? 0;
  }
  return {
    roomId,
    deletedAt: new Date().toISOString(),
    prefsPurged,
    pushTokensPurged: 0,
    messagesPurged,
    photosPurged
  };
}

/** Test-only: clear all in-memory state. No-op against postgres. */
export function _resetChatPersistenceForTests(): void {
  if (pool) return;
  memoryPrefs.clear();
  memoryPushDevices.clear();
}

/** Account deletion: this user's messages (and their photos), push devices, and per-room prefs. */
export async function deleteChatDataForUser(
  userId: string
): Promise<{ pushDevicesPurged: number; prefsPurged: number; messagesPurged: number }> {
  const { messagesPurged, photoKeys } = await deleteChatMessagesBySender(userId);
  const store = chatPhotoStore();
  if (store && photoKeys.length) await store.delete(photoKeys);
  if (!pool) {
    let pushDevicesPurged = 0;
    for (const [deviceId, device] of [...memoryPushDevices.entries()]) {
      if (device.userId !== userId) continue;
      memoryPushDevices.delete(deviceId);
      pushDevicesPurged += 1;
    }
    let prefsPurged = 0;
    for (const [key, pref] of [...memoryPrefs.entries()]) {
      if (pref.userId !== userId) continue;
      memoryPrefs.delete(key);
      prefsPurged += 1;
    }
    return { pushDevicesPurged, prefsPurged, messagesPurged };
  }
  await ensureChatPersistenceReady();
  const devices = await pool.query("DELETE FROM chat_push_devices WHERE user_id = $1", [userId]);
  const prefs = await pool.query("DELETE FROM chat_notification_prefs WHERE user_id = $1", [userId]);
  return { pushDevicesPurged: devices.rowCount ?? 0, prefsPurged: prefs.rowCount ?? 0, messagesPurged };
}
