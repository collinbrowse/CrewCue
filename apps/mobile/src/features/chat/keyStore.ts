/**
 * SecureStore-backed cache for chat crypto state:
 *   - this device's stable id and Curve25519 keypair
 *   - per-room channel symmetric keys (latest version each)
 *
 * SecureStore is async on native, sync on web (see secureStorage.*.ts). The
 * iOS Notification Service Extension reads channel keys via a separate
 * App Group keychain pathway populated by Phase 6 native code; this module
 * only handles the JS cache used by the in-foreground chat UI.
 */
import { deleteItemAsync, getItemAsync, setItemAsync } from "../../storage/secureStorage";
import { generateDeviceKeyPair, type DeviceKeyPair } from "./crypto";

const DEVICE_ID_KEY = "crewcue.chat.deviceId";
const DEVICE_PUBLIC_KEY = "crewcue.chat.devicePublicKey";
const DEVICE_SECRET_KEY = "crewcue.chat.deviceSecretKey";

function channelKeyStorageKey(roomId: string): string {
  return `crewcue.chat.channelKey.${roomId}`;
}

function channelKeyVersionStorageKey(roomId: string): string {
  return `crewcue.chat.channelKeyVersion.${roomId}`;
}

function generateDeviceId(): string {
  // SecureStore IDs are local-only; using random bytes is sufficient. We avoid
  // pulling expo-crypto here so this module stays unit-testable in node.
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Load or create the local device id + keypair. Idempotent. */
export async function ensureDeviceIdentity(): Promise<{ deviceId: string; keyPair: DeviceKeyPair }> {
  const [existingId, pub, sec] = await Promise.all([
    getItemAsync(DEVICE_ID_KEY),
    getItemAsync(DEVICE_PUBLIC_KEY),
    getItemAsync(DEVICE_SECRET_KEY)
  ]);
  if (existingId && pub && sec) {
    return { deviceId: existingId, keyPair: { publicKeyB64: pub, secretKeyB64: sec } };
  }
  const deviceId = existingId ?? generateDeviceId();
  const keyPair = generateDeviceKeyPair();
  await Promise.all([
    setItemAsync(DEVICE_ID_KEY, deviceId),
    setItemAsync(DEVICE_PUBLIC_KEY, keyPair.publicKeyB64),
    setItemAsync(DEVICE_SECRET_KEY, keyPair.secretKeyB64)
  ]);
  return { deviceId, keyPair };
}

/** Save the channel key (base64) and its version for a room. */
export async function saveChannelKey(
  roomId: string,
  keyB64: string,
  keyVersion: number
): Promise<void> {
  await Promise.all([
    setItemAsync(channelKeyStorageKey(roomId), keyB64),
    setItemAsync(channelKeyVersionStorageKey(roomId), String(keyVersion))
  ]);
}

export async function loadChannelKey(
  roomId: string
): Promise<{ keyB64: string; keyVersion: number } | undefined> {
  const [keyB64, version] = await Promise.all([
    getItemAsync(channelKeyStorageKey(roomId)),
    getItemAsync(channelKeyVersionStorageKey(roomId))
  ]);
  if (!keyB64 || !version) return undefined;
  const parsed = Number.parseInt(version, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return { keyB64, keyVersion: parsed };
}

export async function clearChannelKey(roomId: string): Promise<void> {
  await Promise.all([
    deleteItemAsync(channelKeyStorageKey(roomId)),
    deleteItemAsync(channelKeyVersionStorageKey(roomId))
  ]);
}
