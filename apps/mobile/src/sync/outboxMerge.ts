import type { OutboxOperation } from "./outboxTypes";

/** Pure merge for tests and enqueue. */
export function mergeOutboxByConflictKey(
  operations: OutboxOperation[],
  operation: OutboxOperation,
  conflictKey: string
): OutboxOperation[] {
  const withKey: OutboxOperation = { ...operation, conflictKey };
  const next = [...operations];
  const mergeIndex = next.findIndex((entry) => entry.status === "pending" && entry.conflictKey === conflictKey);
  if (mergeIndex >= 0) {
    next[mergeIndex] = withKey;
    return next;
  }
  const idIndex = next.findIndex((entry) => entry.id === withKey.id);
  if (idIndex >= 0) {
    next[idIndex] = withKey;
    return next;
  }
  next.push(withKey);
  return next;
}
