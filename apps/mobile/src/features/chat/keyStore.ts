/**
 * SecureStore: push device id only (message encryption removed for MVP).
 */
import { getItemAsync, setItemAsync } from "../../storage/secureStorage";

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
