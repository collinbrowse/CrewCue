import * as SecureStore from "../storage/secureStorage";
import { createOutboxController } from "./outboxLock";
import type { OutboxOperation, OutboxOperationStatus, OutboxOperationType } from "./outboxTypes";

export type { OutboxOperation, OutboxOperationStatus, OutboxOperationType } from "./outboxTypes";

const OUTBOX_STORE_KEY = "crewcue.sync.outbox";

function isOutboxOperationType(value: unknown): value is OutboxOperationType {
  return value === "ping" || value === "task" || value === "protocol" || value === "checkpoint";
}

function isOutboxOperationStatus(value: unknown): value is OutboxOperationStatus {
  return value === "pending" || value === "sent" || value === "rejected" || value === "conflict";
}

function isOutboxOperation(value: unknown): value is OutboxOperation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<OutboxOperation>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    isOutboxOperationType(candidate.type) &&
    Number.isInteger(candidate.attempts) &&
    (candidate.attempts ?? -1) >= 0 &&
    (candidate.status === undefined || isOutboxOperationStatus(candidate.status))
  );
}

function parseOutbox(raw: string | null): OutboxOperation[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isOutboxOperation).map((operation) => ({
          ...operation,
          status: operation.status ?? "pending"
        }))
      : [];
  } catch {
    return [];
  }
}

async function persist(operations: OutboxOperation[]): Promise<void> {
  if (operations.length === 0) {
    await SecureStore.deleteItemAsync(OUTBOX_STORE_KEY);
    return;
  }

  await SecureStore.setItemAsync(OUTBOX_STORE_KEY, JSON.stringify(operations));
}

const outbox = createOutboxController({
  read: async () => parseOutbox(await SecureStore.getItemAsync(OUTBOX_STORE_KEY)),
  write: persist
});

export async function list(): Promise<OutboxOperation[]> {
  return outbox.read();
}

export async function replace(operations: OutboxOperation[]): Promise<void> {
  await outbox.replace(operations);
}

export async function enqueue(operation: OutboxOperation): Promise<void> {
  await outbox.enqueue(operation);
}

export { mergeOutboxByConflictKey } from "./outboxMerge";

/** Merge by `conflictKey`: replace an existing pending op with the same key. */
export async function enqueueWithConflictKey(operation: OutboxOperation, conflictKey: string): Promise<void> {
  await outbox.enqueueWithConflictKey(operation, conflictKey);
}

export async function dequeue(id: string): Promise<void> {
  await outbox.dequeue(id);
}

/**
 * Send the current outbox and write the result without dropping ops enqueued
 * while `process` is in flight. See `createOutboxController`.
 */
export async function flushOutbox(
  process: (operations: OutboxOperation[]) => Promise<OutboxOperation[]>
): Promise<OutboxOperation[]> {
  return outbox.flush(process);
}

/** Read-modify-write the outbox under the same lock as enqueue and flush. */
export async function updateOutbox(
  fn: (operations: OutboxOperation[]) => OutboxOperation[]
): Promise<OutboxOperation[]> {
  return outbox.update(fn);
}
