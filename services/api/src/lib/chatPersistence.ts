/**
 * Chat persistence: user identity, encrypted backups, per-user channel-key
 * envelopes, notification preferences, and push devices.
 */
import { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  ChatIdentityBackup,
  ChatKeyEnvelope,
  ChatNotificationPref,
  ChatNotificationPrefRecord,
  ChatPushDeviceRecord,
  ChatPushPlatform,
  ChatRetentionResult,
  ChatUserIdentity
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

const memoryIdentities = new Map<string, ChatUserIdentity>();
const memoryBackups = new Map<string, ChatIdentityBackup>();
const memoryRoomVersions = new Map<string, number>();
const memoryEnvelopes = new Map<string, ChatKeyEnvelope[]>();
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
        CREATE TABLE IF NOT EXISTS chat_user_identity (
          user_id TEXT PRIMARY KEY,
          public_key TEXT NOT NULL,
          registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_identity_backup (
          user_id TEXT PRIMARY KEY,
          ciphertext TEXT NOT NULL,
          nonce TEXT NOT NULL,
          version INTEGER NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_room_crypto_state (
          room_id TEXT PRIMARY KEY,
          latest_key_version INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_channel_envelopes (
          room_id TEXT NOT NULL,
          recipient_user_id TEXT NOT NULL,
          sender_ephemeral_public_key TEXT NOT NULL,
          nonce TEXT NOT NULL,
          ciphertext TEXT NOT NULL,
          key_version INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (room_id, recipient_user_id, key_version)
        );
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS chat_channel_envelopes_room_version
        ON chat_channel_envelopes (room_id, key_version DESC);
      `);
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

async function bumpRoomKeyVersion(roomId: string, keyVersion: number): Promise<void> {
  if (!pool) {
    const prev = memoryRoomVersions.get(roomId) ?? 0;
    memoryRoomVersions.set(roomId, Math.max(prev, keyVersion));
    return;
  }
  await pool.query(
    `
      INSERT INTO chat_room_crypto_state (room_id, latest_key_version, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (room_id) DO UPDATE
      SET latest_key_version = GREATEST(chat_room_crypto_state.latest_key_version, EXCLUDED.latest_key_version),
          updated_at = NOW();
    `,
    [roomId, keyVersion]
  );
}

export async function upsertChatUserIdentity(record: ChatUserIdentity): Promise<void> {
  if (!pool) {
    memoryIdentities.set(record.userId, structuredClone(record));
    return;
  }
  await pool.query(
    `
      INSERT INTO chat_user_identity (user_id, public_key, registered_at)
      VALUES ($1, $2, $3::timestamptz)
      ON CONFLICT (user_id) DO UPDATE
      SET public_key = EXCLUDED.public_key,
          registered_at = EXCLUDED.registered_at;
    `,
    [record.userId, record.publicKey, record.registeredAt]
  );
}

export async function getChatUserIdentity(userId: string): Promise<ChatUserIdentity | undefined> {
  if (!pool) {
    return memoryIdentities.get(userId);
  }
  const result = await pool.query<{
    user_id: string;
    public_key: string;
    registered_at: Date | string;
  }>("SELECT user_id, public_key, registered_at FROM chat_user_identity WHERE user_id = $1", [userId]);
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    userId: row.user_id,
    publicKey: row.public_key,
    registeredAt:
      row.registered_at instanceof Date
        ? row.registered_at.toISOString()
        : new Date(row.registered_at).toISOString()
  };
}

export async function upsertChatIdentityBackup(record: ChatIdentityBackup): Promise<void> {
  if (!pool) {
    memoryBackups.set(record.userId, structuredClone(record));
    return;
  }
  await pool.query(
    `
      INSERT INTO chat_identity_backup (user_id, ciphertext, nonce, version, updated_at)
      VALUES ($1, $2, $3, $4, $5::timestamptz)
      ON CONFLICT (user_id) DO UPDATE
      SET ciphertext = EXCLUDED.ciphertext,
          nonce = EXCLUDED.nonce,
          version = EXCLUDED.version,
          updated_at = EXCLUDED.updated_at;
    `,
    [record.userId, record.ciphertext, record.nonce, record.version, record.updatedAt]
  );
}

export async function getChatIdentityBackup(userId: string): Promise<ChatIdentityBackup | undefined> {
  if (!pool) {
    return memoryBackups.get(userId);
  }
  const result = await pool.query<{
    user_id: string;
    ciphertext: string;
    nonce: string;
    version: number;
    updated_at: Date | string;
  }>(
    "SELECT user_id, ciphertext, nonce, version, updated_at FROM chat_identity_backup WHERE user_id = $1",
    [userId]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    userId: row.user_id,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    version: row.version,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString()
  };
}

export async function upsertChatKeyEnvelope(envelope: ChatKeyEnvelope): Promise<void> {
  if (!pool) {
    const list = memoryEnvelopes.get(envelope.roomId) ?? [];
    const existingIdx = list.findIndex(
      (e) => e.recipientUserId === envelope.recipientUserId && e.keyVersion === envelope.keyVersion
    );
    if (existingIdx >= 0) {
      list[existingIdx] = structuredClone(envelope);
    } else {
      list.push(structuredClone(envelope));
    }
    memoryEnvelopes.set(envelope.roomId, list);
    await bumpRoomKeyVersion(envelope.roomId, envelope.keyVersion);
    return;
  }
  await pool.query(
    `
      INSERT INTO chat_channel_envelopes (
        room_id, recipient_user_id, sender_ephemeral_public_key,
        nonce, ciphertext, key_version, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
      ON CONFLICT (room_id, recipient_user_id, key_version) DO UPDATE
      SET sender_ephemeral_public_key = EXCLUDED.sender_ephemeral_public_key,
          nonce = EXCLUDED.nonce,
          ciphertext = EXCLUDED.ciphertext,
          created_at = EXCLUDED.created_at;
    `,
    [
      envelope.roomId,
      envelope.recipientUserId,
      envelope.senderEphemeralPublicKey,
      envelope.nonce,
      envelope.ciphertext,
      envelope.keyVersion,
      envelope.createdAt
    ]
  );
  await bumpRoomKeyVersion(envelope.roomId, envelope.keyVersion);
}

export async function listChatKeyEnvelopesForUser(
  roomId: string,
  recipientUserId: string
): Promise<ChatKeyEnvelope[]> {
  if (!pool) {
    return (memoryEnvelopes.get(roomId) ?? []).filter((e) => e.recipientUserId === recipientUserId);
  }
  const result = await pool.query<{
    room_id: string;
    recipient_user_id: string;
    sender_ephemeral_public_key: string;
    nonce: string;
    ciphertext: string;
    key_version: number;
    created_at: Date | string;
  }>(
    `
      SELECT room_id, recipient_user_id, sender_ephemeral_public_key,
             nonce, ciphertext, key_version, created_at
      FROM chat_channel_envelopes
      WHERE room_id = $1 AND recipient_user_id = $2
      ORDER BY key_version DESC
    `,
    [roomId, recipientUserId]
  );
  return result.rows.map((row) => ({
    roomId: row.room_id,
    recipientUserId: row.recipient_user_id,
    senderEphemeralPublicKey: row.sender_ephemeral_public_key,
    nonce: row.nonce,
    ciphertext: row.ciphertext,
    keyVersion: row.key_version,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  }));
}

export async function getLatestChatKeyVersionForRoom(roomId: string): Promise<number | undefined> {
  if (!pool) {
    const fromState = memoryRoomVersions.get(roomId);
    if (typeof fromState === "number" && fromState > 0) return fromState;
    const envs = memoryEnvelopes.get(roomId) ?? [];
    if (envs.length === 0) return undefined;
    return envs.reduce((max, e) => (e.keyVersion > max ? e.keyVersion : max), envs[0]!.keyVersion);
  }
  const state = await pool.query<{ latest_key_version: number }>(
    "SELECT latest_key_version FROM chat_room_crypto_state WHERE room_id = $1",
    [roomId]
  );
  const fromState = state.rows[0]?.latest_key_version;
  if (typeof fromState === "number" && fromState > 0) return fromState;
  const result = await pool.query<{ max_key_version: number | null }>(
    "SELECT MAX(key_version) AS max_key_version FROM chat_channel_envelopes WHERE room_id = $1",
    [roomId]
  );
  const max = result.rows[0]?.max_key_version;
  return typeof max === "number" ? max : undefined;
}

/** Member removed: bump version and purge envelopes so remaining clients re-wrap. */
export async function rotateRoomChannelKey(roomId: string): Promise<number> {
  const latest = (await getLatestChatKeyVersionForRoom(roomId)) ?? 0;
  const nextVersion = latest + 1;
  if (!pool) {
    memoryEnvelopes.delete(roomId);
    memoryRoomVersions.set(roomId, nextVersion);
    return nextVersion;
  }
  await pool.query("DELETE FROM chat_channel_envelopes WHERE room_id = $1", [roomId]);
  await bumpRoomKeyVersion(roomId, nextVersion);
  return nextVersion;
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
    const envs = memoryEnvelopes.get(roomId) ?? [];
    memoryEnvelopes.delete(roomId);
    memoryRoomVersions.delete(roomId);
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
      envelopesPurged: envs.length,
      prefsPurged,
      pushTokensPurged: 0
    };
  }
  await ensureChatPersistenceReady();
  const envs = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM chat_channel_envelopes WHERE room_id = $1",
    [roomId]
  );
  const prefs = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM chat_notification_prefs WHERE room_id = $1",
    [roomId]
  );
  await pool.query("DELETE FROM chat_channel_envelopes WHERE room_id = $1", [roomId]);
  await pool.query("DELETE FROM chat_notification_prefs WHERE room_id = $1", [roomId]);
  await pool.query("DELETE FROM chat_room_crypto_state WHERE room_id = $1", [roomId]);
  return {
    roomId,
    deletedAt: new Date().toISOString(),
    envelopesPurged: Number.parseInt(envs.rows[0]?.count ?? "0", 10),
    prefsPurged: Number.parseInt(prefs.rows[0]?.count ?? "0", 10),
    pushTokensPurged: 0
  };
}

/** Test-only: clear all in-memory state. No-op against postgres. */
export function _resetChatPersistenceForTests(): void {
  if (pool) return;
  memoryIdentities.clear();
  memoryBackups.clear();
  memoryRoomVersions.clear();
  memoryEnvelopes.clear();
  memoryPrefs.clear();
  memoryPushDevices.clear();
}
