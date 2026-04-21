import * as SecureStore from "expo-secure-store";
import type { ApiClient, PostSyncHeartbeatInput, PostSyncHeartbeatResponse } from "../api/client";
import { parsePendingHeartbeat, type PendingHeartbeat } from "./pendingHeartbeatParse";
import { postSyncHeartbeatWithRetryWithPersistence } from "./pendingHeartbeatRetry";

export type { PendingHeartbeat } from "./pendingHeartbeatParse";
export { parsePendingHeartbeat } from "./pendingHeartbeatParse";

const PENDING_HEARTBEAT_KEY = "crewcue.ws5.pendingHeartbeat";

export async function loadPendingHeartbeat(): Promise<PendingHeartbeat | undefined> {
  const raw = await SecureStore.getItemAsync(PENDING_HEARTBEAT_KEY);
  return parsePendingHeartbeat(raw);
}

export async function savePendingHeartbeat(input: PendingHeartbeat): Promise<void> {
  await SecureStore.setItemAsync(PENDING_HEARTBEAT_KEY, JSON.stringify(input));
}

export async function clearPendingHeartbeat(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_HEARTBEAT_KEY);
}

export async function postSyncHeartbeatWithRetry(
  client: ApiClient,
  input: PendingHeartbeat & Pick<PostSyncHeartbeatInput, "lastSuccessfulFlushAt">
): Promise<
  | { persistedForRetry: false; response: PostSyncHeartbeatResponse }
  | { persistedForRetry: true; pendingHeartbeat: PendingHeartbeat }
> {
  return postSyncHeartbeatWithRetryWithPersistence(client, input, savePendingHeartbeat);
}

export async function flushPendingHeartbeat(client: ApiClient): Promise<
  | { flushed: false; pendingHeartbeat?: PendingHeartbeat }
  | { flushed: true; pendingHeartbeat: PendingHeartbeat; response: PostSyncHeartbeatResponse }
> {
  const pendingHeartbeat = await loadPendingHeartbeat();
  if (!pendingHeartbeat) {
    return { flushed: false };
  }

  const response = await client.postSyncHeartbeat(pendingHeartbeat.roomId, pendingHeartbeat);
  await clearPendingHeartbeat();
  return { flushed: true, pendingHeartbeat, response };
}
