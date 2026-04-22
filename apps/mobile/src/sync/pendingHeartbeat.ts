import type { ApiClient, PostSyncHeartbeatInput, PostSyncHeartbeatResponse } from "../api/client";
import { enqueue, dequeue, list, type OutboxOperation } from "./outboxStore";
import { isPendingHeartbeat, parsePendingHeartbeat, type PendingHeartbeat } from "./pendingHeartbeatParse";
import { postSyncHeartbeatWithRetryWithPersistence } from "./pendingHeartbeatRetry";

export type { PendingHeartbeat } from "./pendingHeartbeatParse";
export { isPendingHeartbeat, parsePendingHeartbeat } from "./pendingHeartbeatParse";

function pendingHeartbeatOperationId(input: PendingHeartbeat): string {
  return `sync-heartbeat:${input.roomId}:${input.deviceId}`;
}

function toPendingHeartbeatOperation(input: PendingHeartbeat, attempts = 0): OutboxOperation {
  return {
    id: pendingHeartbeatOperationId(input),
    type: "ping",
    payload: input,
    attempts
  };
}

async function loadPendingHeartbeatOperation(): Promise<OutboxOperation | undefined> {
  const operations = await list();
  return operations.find((operation) => operation.type === "ping" && isPendingHeartbeat(operation.payload));
}

export async function loadPendingHeartbeat(): Promise<PendingHeartbeat | undefined> {
  const operation = await loadPendingHeartbeatOperation();
  return operation && isPendingHeartbeat(operation.payload) ? operation.payload : undefined;
}

export async function savePendingHeartbeat(input: PendingHeartbeat): Promise<void> {
  const operations = await list();
  const existing = operations.find((operation) => operation.id === pendingHeartbeatOperationId(input));
  await enqueue(toPendingHeartbeatOperation(input, existing?.attempts ?? 0));
}

export async function clearPendingHeartbeat(): Promise<void> {
  const operation = await loadPendingHeartbeatOperation();
  if (operation) {
    await dequeue(operation.id);
  }
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
  const operation = await loadPendingHeartbeatOperation();
  if (!operation || !isPendingHeartbeat(operation.payload)) {
    return { flushed: false };
  }

  const pendingHeartbeat = operation.payload;
  const response = await client.postSyncHeartbeat(pendingHeartbeat.roomId, pendingHeartbeat);
  await dequeue(operation.id);
  return { flushed: true, pendingHeartbeat, response };
}
