/**
 * Per-user, per-room notification preference for crew chat.
 * Three options: `all` | `mentions` | `none`.
 *
 * Server is source of truth. We cache the most recent value in SecureStore so
 * the UI can render immediately on cold start without an API round-trip.
 */
import type { ChatNotificationPref } from "@crewcue/contracts";
import * as SecureStore from "../../storage/secureStorage";
import { isValidPref } from "./notificationPrefsValidation";

export { isValidPref } from "./notificationPrefsValidation";

const PREF_PREFIX = "crewcue.chat.notifPref.";

function storageKey(roomId: string): string {
  return `${PREF_PREFIX}${roomId}`;
}

export async function readCachedPref(roomId: string): Promise<ChatNotificationPref> {
  const raw = await SecureStore.getItemAsync(storageKey(roomId));
  if (raw && isValidPref(raw)) return raw;
  return "all";
}

export async function writeCachedPref(roomId: string, pref: ChatNotificationPref): Promise<void> {
  if (!isValidPref(pref)) throw new Error(`writeCachedPref: invalid preference '${String(pref)}'`);
  await SecureStore.setItemAsync(storageKey(roomId), pref);
}

export async function clearCachedPref(roomId: string): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(roomId));
}
