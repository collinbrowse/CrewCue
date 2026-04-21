import { ApiError, type ApiClient, type PostSyncHeartbeatInput, type PostSyncHeartbeatResponse } from "../api/client";
import type { PendingHeartbeat } from "./pendingHeartbeatParse";

export async function postSyncHeartbeatWithRetryWithPersistence(
  client: ApiClient,
  input: PendingHeartbeat & Pick<PostSyncHeartbeatInput, "lastSuccessfulFlushAt">,
  persistForRetry: (pending: PendingHeartbeat) => Promise<void>
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
    await persistForRetry(pendingHeartbeat);
    return { persistedForRetry: true, pendingHeartbeat };
  }
}
