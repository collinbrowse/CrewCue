/**
 * SecureStore: push device id, per-room keys (via chat-crypto), NSE mirror.
 */
import { deleteItemAsync, getItemAsync, setItemAsync } from "../../storage/secureStorage";
import { loadLocalRoomKey, saveLocalRoomKey } from "@crewcue/chat-crypto";
import { chatSecureStorageAdapter } from "./secureStorageAdapter";
import { removeChannelKeyFromExtension, shareChannelKeyWithExtension } from "./nativeKeyBridge";

const DEVICE_ID_KEY = "crewcue.chat.deviceId";

function generateDeviceId(): string {
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

/** Stable per-install id for push registration only. */
export async function ensureDeviceIdentity(): Promise<{ deviceId: string }> {
  const existingId = await getItemAsync(DEVICE_ID_KEY);
  if (existingId) return { deviceId: existingId };
  const deviceId = generateDeviceId();
  await setItemAsync(DEVICE_ID_KEY, deviceId);
  return { deviceId };
}

export async function saveChannelKey(
  roomId: string,
  keyB64: string,
  keyVersion: number
): Promise<void> {
  await saveLocalRoomKey(chatSecureStorageAdapter, roomId, keyB64, keyVersion);
  await shareChannelKeyWithExtension(roomId, keyB64);
}

export async function loadChannelKey(
  roomId: string
): Promise<{ keyB64: string; keyVersion: number } | undefined> {
  return loadLocalRoomKey(chatSecureStorageAdapter, roomId);
}

export async function clearChannelKey(roomId: string): Promise<void> {
  const { clearLocalRoomKey } = await import("@crewcue/chat-crypto");
  await clearLocalRoomKey(chatSecureStorageAdapter, roomId);
  await removeChannelKeyFromExtension(roomId);
}
