/**
 * Serialized read-modify-write for the mobile sync outbox.
 *
 * A flush used to `list()`, send over the network, then `replace()` the whole
 * list with that snapshot. A check-in or task enqueued during the send was
 * persisted, then deleted when the snapshot was written back.
 */
import { mergeOutboxByConflictKey } from "./outboxMerge";
import type { OutboxOperation } from "./outboxTypes";

export function createAsyncMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

export type OutboxIo = {
  read(): Promise<OutboxOperation[]>;
  write(operations: OutboxOperation[]): Promise<void>;
};

export function createOutboxController(io: OutboxIo) {
  const withLock = createAsyncMutex();

  async function mutate(
    fn: (operations: OutboxOperation[]) => OutboxOperation[]
  ): Promise<OutboxOperation[]> {
    return withLock(async () => {
      const current = await io.read();
      const next = fn(current);
      await io.write(next);
      return next;
    });
  }

  return {
    read: (): Promise<OutboxOperation[]> => io.read(),
    enqueue(operation: OutboxOperation): Promise<OutboxOperation[]> {
      return mutate((operations) => {
        const existingIndex = operations.findIndex((entry) => entry.id === operation.id);
        if (existingIndex >= 0) {
          const next = operations.slice();
          next[existingIndex] = operation;
          return next;
        }
        return [...operations, operation];
      });
    },
    enqueueWithConflictKey(operation: OutboxOperation, conflictKey: string): Promise<OutboxOperation[]> {
      return mutate((operations) => mergeOutboxByConflictKey(operations, operation, conflictKey));
    },
    dequeue(id: string): Promise<void> {
      return withLock(async () => {
        const operations = await io.read();
        const remaining = operations.filter((entry) => entry.id !== id);
        if (remaining.length === operations.length) {
          return;
        }
        await io.write(remaining);
      });
    },
    replace(operations: OutboxOperation[]): Promise<void> {
      return withLock(async () => {
        await io.write(operations);
      });
    },
    /**
     * Hold the lock for the whole flush, including the network send inside
     * `process`. Enqueues started during the send wait, then append onto the
     * flushed list instead of being overwritten by it.
     */
    flush(
      process: (operations: OutboxOperation[]) => Promise<OutboxOperation[]>
    ): Promise<OutboxOperation[]> {
      return withLock(async () => {
        const operations = await io.read();
        const next = await process(operations);
        await io.write(next);
        return next;
      });
    },
    update(fn: (operations: OutboxOperation[]) => OutboxOperation[]): Promise<OutboxOperation[]> {
      return mutate(fn);
    }
  };
}
