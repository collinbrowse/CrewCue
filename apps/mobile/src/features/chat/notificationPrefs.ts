/**
 * Per-user, per-room notification preference for crew chat.
 * Three options: `all` | `mentions` | `none`.
 *
 * Server is source of truth. We cache the most recent value in SecureStore so
 * the UI can render immediately on cold start without an API round-trip.
 *
 * SecureStore I/O is loaded lazily so the pure validator is testable from
 * Node without dragging react-native into the test runner.
 */
import type { ChatNotificationPref } from "@crewcue/contracts";

const PREF_PREFIX = "crewcue.chat.notifPref.";
const VALID: readonly ChatNotificationPref[] = ["all", "mentions", "none"];

function storageKey(roomId: string): string {
  return `${PREF_PREFIX}${roomId}`;
}

async function getSecureStore() {
  return import("../../storage/secureStorage");
}

export function isValidPref(value: unknown): value is ChatNotificationPref {
  return typeof value === "string" && (VALID as readonly string[]).includes(value);
}

export async function readCachedPref(roomId: string): Promise<ChatNotificationPref> {
  const { getItemAsync } = await getSecureStore();
  const raw = await getItemAsync(storageKey(roomId));
  if (raw && isValidPref(raw)) return raw;
  return "all";
}

export async function writeCachedPref(roomId: string, pref: ChatNotificationPref): Promise<void> {
  if (!isValidPref(pref)) throw new Error(`writeCachedPref: invalid preference '${String(pref)}'`);
  const { setItemAsync } = await getSecureStore();
  await setItemAsync(storageKey(roomId), pref);
}

export async function clearCachedPref(roomId: string): Promise<void> {
  const { deleteItemAsync } = await getSecureStore();
  await deleteItemAsync(storageKey(roomId));
}
