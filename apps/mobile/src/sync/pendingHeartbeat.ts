import * as SecureStore from "expo-secure-store";
import { ApiError, type ApiClient, type PostSyncHeartbeatInput, type PostSyncHeartbeatResponse } from "../api/client";

const PENDING_HEARTBEAT_KEY = "crewcue.ws5.pendingHeartbeat";

export type PendingHeartbeat = {
  roomId: string;
  deviceId: string;
  pendingQueueCount: number;
};

function parsePendingHeartbeat(raw: string | null): PendingHeartbeat | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.roomId === "string" &&
      typeof parsed.deviceId === "string" &&
      typeof parsed.pendingQueueCount === "number" &&
      Number.isInteger(parsed.pendingQueueCount) &&
      parsed.pendingQueueCount >= 0
    ) {
      return {
        roomId: parsed.roomId,
        deviceId: parsed.deviceId,
        pendingQueueCount: parsed.pendingQueueCount
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

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
  try {
    const response = await client.postSyncHeartbeat(input.roomId, input);
    return { persistedForRetry: false, response };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    const pendingHeartbeat: PendingHeartbeat = {
      roomId: input.roomId,
      deviceId: input.deviceId,
      pendingQueueCount: input.pendingQueueCount
    };
    await savePendingHeartbeat(pendingHeartbeat);
    return { persistedForRetry: true, pendingHeartbeat };
  }
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
