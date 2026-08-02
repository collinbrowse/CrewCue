import * as SecureStore from "../storage/secureStorage";
import type { OutboxOperation, OutboxOperationStatus, OutboxOperationType } from "./outboxTypes";
import { mergeOutboxByConflictKey, mergeProcessedBatch } from "./outboxMerge";

export type { OutboxOperation, OutboxOperationStatus, OutboxOperationType } from "./outboxTypes";

export { mergeOutboxByConflictKey } from "./outboxMerge";

const OUTBOX_STORE_KEY = "crewcue.sync.outbox";

/** Serialize all outbox mutations so read/modify/write cannot interleave. */
let mutationChain: Promise<void> = Promise.resolve();

function withOutboxLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(fn, fn);
  mutationChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

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

async function readStore(): Promise<OutboxOperation[]> {
  return parseOutbox(await SecureStore.getItemAsync(OUTBOX_STORE_KEY));
}

async function persist(operations: OutboxOperation[]): Promise<void> {
  if (operations.length === 0) {
    await SecureStore.deleteItemAsync(OUTBOX_STORE_KEY);
    return;
  }

  await SecureStore.setItemAsync(OUTBOX_STORE_KEY, JSON.stringify(operations));
}

export async function list(): Promise<OutboxOperation[]> {
  return readStore();
}

/** Blind full replace. Prefer `commitProcessedBatch` / `mutate` when concurrent enqueues are possible. */
export async function replace(operations: OutboxOperation[]): Promise<void> {
  await withOutboxLock(async () => {
    await persist(operations);
  });
}

/**
 * Apply processed batch statuses onto the live store without dropping ops
 * enqueued after the batch snapshot was taken.
 */
export async function commitProcessedBatch(
  original: OutboxOperation[],
  processed: OutboxOperation[]
): Promise<OutboxOperation[]> {
  const originalIds = new Set(original.map((op) => op.id));
  const processedById = new Map(processed.map((op) => [op.id, op]));
  return mutate((current) => mergeProcessedBatch(current, originalIds, processedById));
}

export async function mutate(
  updater: (operations: OutboxOperation[]) => OutboxOperation[]
): Promise<OutboxOperation[]> {
  return withOutboxLock(async () => {
    const current = await readStore();
    const next = updater(current);
    await persist(next);
    return next;
  });
}

export async function enqueue(operation: OutboxOperation): Promise<void> {
  await mutate((operations) => {
    const next = [...operations];
    const existingIndex = next.findIndex((entry) => entry.id === operation.id);

    if (existingIndex >= 0) {
      next[existingIndex] = operation;
    } else {
      next.push(operation);
    }

    return next;
  });
}

/** Merge by `conflictKey`: replace an existing pending op with the same key. */
export async function enqueueWithConflictKey(operation: OutboxOperation, conflictKey: string): Promise<void> {
  await mutate((operations) => mergeOutboxByConflictKey(operations, operation, conflictKey));
}

export async function dequeue(id: string): Promise<void> {
  await mutate((operations) => {
    const remaining = operations.filter((entry) => entry.id !== id);
    return remaining.length === operations.length ? operations : remaining;
  });
}
