import type { ChatBackupPayloadV1, ChatIdentityBackup, ChatIdentityBackupUpload } from "@crewcue/contracts";
import {
  decryptBackupSecret,
  encryptBackupSecret,
  generateBackupSecret,
  generateIdentityKeyPair,
  publicKeyFromIdentitySecret
} from "./crypto.js";
import type { ChatCryptoStorageAdapter, IdentityKeyPair, RoomKeyMaterial } from "./types.js";

const IDENTITY_PUBLIC_KEY = "crewcue.chat.identity.publicKey";
const IDENTITY_SECRET_KEY = "crewcue.chat.identity.secretKey";
const BACKUP_LOCAL_SECRET = "crewcue.chat.backup.localSecret";
const ROOM_KEY_INDEX = "crewcue.chat.roomKeyIndex";

function roomKeyStorageKey(roomId: string): string {
  return `crewcue.chat.roomKey.${roomId}`;
}

function roomKeyVersionStorageKey(roomId: string): string {
  return `crewcue.chat.roomKeyVersion.${roomId}`;
}

async function loadRoomKeyIndex(storage: ChatCryptoStorageAdapter): Promise<string[]> {
  const raw = await storage.getItem(ROOM_KEY_INDEX);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((roomId): roomId is string => typeof roomId === "string" && roomId.length > 0);
  } catch {
    return [];
  }
}

async function saveRoomKeyIndex(storage: ChatCryptoStorageAdapter, roomIds: string[]): Promise<void> {
  const unique = Array.from(new Set(roomIds.filter((roomId) => roomId.length > 0))).sort();
  await storage.setItem(ROOM_KEY_INDEX, JSON.stringify(unique));
}

async function rememberRoomKey(storage: ChatCryptoStorageAdapter, roomId: string): Promise<void> {
  const known = await loadRoomKeyIndex(storage);
  if (!known.includes(roomId)) {
    await saveRoomKeyIndex(storage, [...known, roomId]);
  }
}

async function forgetRoomKey(storage: ChatCryptoStorageAdapter, roomId: string): Promise<void> {
  const known = await loadRoomKeyIndex(storage);
  if (known.includes(roomId)) {
    await saveRoomKeyIndex(
      storage,
      known.filter((knownRoomId) => knownRoomId !== roomId)
    );
  }
}

export async function ensureBackupLocalSecret(storage: ChatCryptoStorageAdapter): Promise<string> {
  const existing = await storage.getItem(BACKUP_LOCAL_SECRET);
  if (existing) return existing;
  const secret = generateBackupSecret();
  await storage.setItem(BACKUP_LOCAL_SECRET, secret);
  return secret;
}

export async function ensureIdentity(storage: ChatCryptoStorageAdapter): Promise<IdentityKeyPair> {
  const [pub, sec] = await Promise.all([
    storage.getItem(IDENTITY_PUBLIC_KEY),
    storage.getItem(IDENTITY_SECRET_KEY)
  ]);
  if (pub && sec) {
    return { publicKeyB64: pub, secretKeyB64: sec };
  }
  const keyPair = generateIdentityKeyPair();
  await Promise.all([
    storage.setItem(IDENTITY_PUBLIC_KEY, keyPair.publicKeyB64),
    storage.setItem(IDENTITY_SECRET_KEY, keyPair.secretKeyB64)
  ]);
  return keyPair;
}

export async function restoreIdentityFromBackupPayload(
  storage: ChatCryptoStorageAdapter,
  payload: ChatBackupPayloadV1
): Promise<IdentityKeyPair> {
  const publicKeyB64 = publicKeyFromIdentitySecret(payload.identitySecretB64);
  const keyPair = {
    publicKeyB64,
    secretKeyB64: payload.identitySecretB64
  };
  await Promise.all([
    storage.setItem(IDENTITY_PUBLIC_KEY, publicKeyB64),
    storage.setItem(IDENTITY_SECRET_KEY, payload.identitySecretB64)
  ]);
  for (const [roomId, snap] of Object.entries(payload.roomKeys)) {
    const local = await loadLocalRoomKey(storage, roomId);
    if (!local || snap.keyVersion > local.keyVersion) {
      await saveLocalRoomKey(storage, roomId, snap.keyB64, snap.keyVersion);
    }
  }
  return ensureIdentity(storage);
}

export function buildBackupPayload(
  identity: IdentityKeyPair,
  roomKeys: Record<string, RoomKeyMaterial>
): ChatBackupPayloadV1 {
  const roomKeysPayload: ChatBackupPayloadV1["roomKeys"] = {};
  for (const [roomId, material] of Object.entries(roomKeys)) {
    roomKeysPayload[roomId] = { keyB64: material.keyB64, keyVersion: material.keyVersion };
  }
  return {
    identitySecretB64: identity.secretKeyB64,
    roomKeys: roomKeysPayload
  };
}

export async function encryptBackupForUpload(
  storage: ChatCryptoStorageAdapter,
  identity: IdentityKeyPair,
  roomKeys: Record<string, RoomKeyMaterial>,
  version: number
): Promise<ChatIdentityBackupUpload> {
  const localSecret = await ensureBackupLocalSecret(storage);
  const payload = JSON.stringify(buildBackupPayload(identity, roomKeys));
  const encrypted = encryptBackupSecret(payload, localSecret);
  return {
    ciphertext: encrypted.ciphertextB64,
    nonce: encrypted.nonceB64,
    version
  };
}

export function decryptBackupFromServer(
  backup: Pick<ChatIdentityBackup, "ciphertext" | "nonce">,
  localSecretB64: string
): ChatBackupPayloadV1 | null {
  const opened = decryptBackupSecret(backup.ciphertext, backup.nonce, localSecretB64);
  if (!opened) return null;
  try {
    return JSON.parse(opened) as ChatBackupPayloadV1;
  } catch {
    return null;
  }
}

export async function saveLocalRoomKey(
  storage: ChatCryptoStorageAdapter,
  roomId: string,
  keyB64: string,
  keyVersion: number
): Promise<void> {
  await Promise.all([
    storage.setItem(roomKeyStorageKey(roomId), keyB64),
    storage.setItem(roomKeyVersionStorageKey(roomId), String(keyVersion))
  ]);
  await rememberRoomKey(storage, roomId);
}

export async function loadLocalRoomKey(
  storage: ChatCryptoStorageAdapter,
  roomId: string
): Promise<RoomKeyMaterial | undefined> {
  const [keyB64, versionRaw] = await Promise.all([
    storage.getItem(roomKeyStorageKey(roomId)),
    storage.getItem(roomKeyVersionStorageKey(roomId))
  ]);
  if (!keyB64 || !versionRaw) return undefined;
  const keyVersion = Number.parseInt(versionRaw, 10);
  if (!Number.isFinite(keyVersion)) return undefined;
  return { keyB64, keyVersion };
}

export async function loadAllLocalRoomKeys(
  storage: ChatCryptoStorageAdapter,
  roomIds: string[] = []
): Promise<Record<string, RoomKeyMaterial>> {
  const allRoomIds = Array.from(new Set([...(await loadRoomKeyIndex(storage)), ...roomIds]));
  const loaded: Record<string, RoomKeyMaterial> = {};
  for (const roomId of allRoomIds) {
    const material = await loadLocalRoomKey(storage, roomId);
    if (material) {
      loaded[roomId] = material;
    }
  }
  return loaded;
}

export async function clearLocalRoomKey(storage: ChatCryptoStorageAdapter, roomId: string): Promise<void> {
  await Promise.all([
    storage.deleteItem(roomKeyStorageKey(roomId)),
    storage.deleteItem(roomKeyVersionStorageKey(roomId))
  ]);
  await forgetRoomKey(storage, roomId);
}
