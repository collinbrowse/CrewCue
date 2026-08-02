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

/**
 * Merge batch processing results into the live store snapshot.
 *
 * Ops present in `current` but not in the original batch (concurrent enqueues)
 * are preserved. Ops removed from the store during processing are not re-added.
 */
export function mergeProcessedBatch(
  current: OutboxOperation[],
  originalIds: ReadonlySet<string>,
  processedById: ReadonlyMap<string, OutboxOperation>
): OutboxOperation[] {
  return current.map((op) => {
    if (originalIds.has(op.id)) {
      return processedById.get(op.id) ?? op;
    }
    return op;
  });
}
