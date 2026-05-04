import * as SecureStore from "../storage/secureStorage";

export type OutboxOperationType = "ping" | "task" | "protocol" | "checkpoint";
export type OutboxOperationStatus = "pending" | "sent" | "rejected" | "conflict";

export type OutboxOperation = {
  id: string;
  type: OutboxOperationType;
  payload: any;
  attempts: number;
  status: OutboxOperationStatus;
  feedback?: string;
  updatedAt?: string;
};

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

export async function list(): Promise<OutboxOperation[]> {
  return parseOutbox(await SecureStore.getItemAsync(OUTBOX_STORE_KEY));
}

export async function replace(operations: OutboxOperation[]): Promise<void> {
  await persist(operations);
}

export async function enqueue(operation: OutboxOperation): Promise<void> {
  const operations = await list();
  const existingIndex = operations.findIndex((entry) => entry.id === operation.id);

  if (existingIndex >= 0) {
    operations[existingIndex] = operation;
  } else {
    operations.push(operation);
  }

  await persist(operations);
}

export async function dequeue(id: string): Promise<void> {
  const operations = await list();
  const remaining = operations.filter((entry) => entry.id !== id);

  if (remaining.length === operations.length) {
    return;
  }

  await persist(remaining);
}
