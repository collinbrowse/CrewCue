/**
 * Serialized read-modify-write for one room's chat outbox.
 *
 * Each mutator used to load the SecureStore snapshot, edit it, and write it
 * back. A photo send finishing (`markSent` / `removeEntry`) could load before
 * a follow-up `enqueue` saved, then write the old snapshot and delete the new
 * text. `markSending` then missed that entry and returned false, so the
 * follow-up never reached Stream and was gone after the next launch.
 */
import {
  makeEntry,
  type ChatOutbox,
  type ChatOutboxEntry,
  type EnqueueChatMessageInput
} from "./messageQueueCore";

function createAsyncMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
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

export type ChatOutboxIo = {
  read(): Promise<ChatOutbox>;
  write(box: ChatOutbox): Promise<void>;
};

export function createChatOutboxController(io: ChatOutboxIo) {
  const withLock = createAsyncMutex();

  function mutate<T>(fn: (box: ChatOutbox) => { box: ChatOutbox; result: T }): Promise<T> {
    return withLock(async () => {
      const current = await io.read();
      const next = fn(current);
      await io.write(next.box);
      return next.result;
    });
  }

  return {
    enqueue(input: EnqueueChatMessageInput, now = Date.now()): Promise<ChatOutboxEntry> {
      return mutate((box) => {
        const entry = makeEntry(input, now);
        return { box: { ...box, entries: [...box.entries, entry] }, result: entry };
      });
    },

    markSending(entryId: string): Promise<boolean> {
      return withLock(async () => {
        const box = await io.read();
        const index = box.entries.findIndex((entry) => entry.id === entryId);
        const target = index >= 0 ? box.entries[index] : undefined;
        if (!target || target.status === "sending" || target.status === "sent") {
          return false;
        }
        const nextEntry: ChatOutboxEntry = {
          ...target,
          status: "sending",
          attempts: target.attempts + 1
        };
        delete nextEntry.lastError;
        const entries = box.entries.slice();
        entries[index] = nextEntry;
        await io.write({ ...box, entries });
        return true;
      });
    },

    markSent(entryId: string, remoteMessageId: string): Promise<void> {
      return withLock(async () => {
        const box = await io.read();
        const index = box.entries.findIndex((entry) => entry.id === entryId);
        if (index < 0) {
          return;
        }
        const entries = box.entries.slice();
        entries[index] = {
          ...box.entries[index]!,
          status: "sent",
          remoteMessageId
        };
        await io.write({ ...box, entries });
      });
    },

    markFailed(entryId: string, error: string): Promise<void> {
      return withLock(async () => {
        const box = await io.read();
        const index = box.entries.findIndex((entry) => entry.id === entryId);
        if (index < 0) {
          return;
        }
        const entries = box.entries.slice();
        entries[index] = {
          ...box.entries[index]!,
          status: "failed",
          lastError: error
        };
        await io.write({ ...box, entries });
      });
    },

    removeEntry(entryId: string): Promise<void> {
      return mutate((box) => ({
        box: { ...box, entries: box.entries.filter((entry) => entry.id !== entryId) },
        result: undefined
      }));
    },

    reapSent(olderThanMs = 60_000, now = Date.now()): Promise<number> {
      return mutate((box) => {
        const entries = box.entries.filter((entry) => {
          if (entry.status !== "sent") return true;
          return now - entry.createdAtMs < olderThanMs;
        });
        return {
          box: { ...box, entries },
          result: box.entries.length - entries.length
        };
      });
    }
  };
}
