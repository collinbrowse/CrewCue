/**
 * Chat outbox persistence with per-room serialized read-modify-write.
 * SecureStore binding lives in `messageQueue.ts`; this module stays free of
 * native imports so Node unit tests can inject an in-memory KV.
 */
import {
  makeEntry,
  type ChatOutbox,
  type ChatOutboxEntry,
  type EnqueueChatMessageInput
} from "./messageQueueCore";

export type ChatOutboxKv = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

const DEFAULT_STORAGE_PREFIX = "crewcue.chat.outbox.";

export type ChatOutboxStore = {
  loadOutbox(roomId: string): Promise<ChatOutbox>;
  enqueueChatMessage(input: EnqueueChatMessageInput, now?: number): Promise<ChatOutboxEntry>;
  markSending(roomId: string, entryId: string): Promise<boolean>;
  markSent(roomId: string, entryId: string, remoteMessageId: string): Promise<void>;
  markFailed(roomId: string, entryId: string, error: string): Promise<void>;
  removeEntry(roomId: string, entryId: string): Promise<void>;
  reapSent(roomId: string, olderThanMs?: number, now?: number): Promise<number>;
};

export function createChatOutboxStore(
  storage: ChatOutboxKv,
  storagePrefix = DEFAULT_STORAGE_PREFIX
): ChatOutboxStore {
  /** Serialize all mutations per room so concurrent RMW cannot drop entries. */
  const mutationChains = new Map<string, Promise<void>>();

  function storageKey(roomId: string): string {
    return `${storagePrefix}${roomId}`;
  }

  function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const previous = mutationChains.get(roomId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    mutationChains.set(
      roomId,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }

  async function readOutbox(roomId: string): Promise<ChatOutbox> {
    const raw = await storage.getItemAsync(storageKey(roomId));
    if (!raw) return { roomId, entries: [] };
    try {
      const parsed = JSON.parse(raw) as ChatOutbox;
      if (!parsed || parsed.roomId !== roomId || !Array.isArray(parsed.entries)) {
        return { roomId, entries: [] };
      }
      return parsed;
    } catch {
      return { roomId, entries: [] };
    }
  }

  async function writeOutbox(box: ChatOutbox): Promise<void> {
    if (box.entries.length === 0) {
      await storage.deleteItemAsync(storageKey(box.roomId));
      return;
    }
    await storage.setItemAsync(storageKey(box.roomId), JSON.stringify(box));
  }

  async function mutate(
    roomId: string,
    updater: (box: ChatOutbox) => ChatOutbox | Promise<ChatOutbox>
  ): Promise<ChatOutbox> {
    return withRoomLock(roomId, async () => {
      const current = await readOutbox(roomId);
      const next = await updater(current);
      await writeOutbox(next);
      return next;
    });
  }

  return {
    loadOutbox(roomId) {
      // Reads do not need the write lock; writers always re-read under lock.
      return readOutbox(roomId);
    },

    async enqueueChatMessage(input, now = Date.now()) {
      const entry = makeEntry(input, now);
      await mutate(input.roomId, (box) => {
        box.entries.push(entry);
        return box;
      });
      return entry;
    },

    async markSending(roomId, entryId) {
      let claimed = false;
      await mutate(roomId, (box) => {
        const target = box.entries.find((e) => e.id === entryId);
        if (!target) return box;
        if (target.status === "sending" || target.status === "sent") return box;
        target.status = "sending";
        target.attempts += 1;
        delete target.lastError;
        claimed = true;
        return box;
      });
      return claimed;
    },

    async markSent(roomId, entryId, remoteMessageId) {
      await mutate(roomId, (box) => {
        const target = box.entries.find((e) => e.id === entryId);
        if (!target) return box;
        target.status = "sent";
        target.remoteMessageId = remoteMessageId;
        return box;
      });
    },

    async markFailed(roomId, entryId, error) {
      await mutate(roomId, (box) => {
        const target = box.entries.find((e) => e.id === entryId);
        if (!target) return box;
        target.status = "failed";
        target.lastError = error;
        return box;
      });
    },

    async removeEntry(roomId, entryId) {
      await mutate(roomId, (box) => {
        box.entries = box.entries.filter((e) => e.id !== entryId);
        return box;
      });
    },

    async reapSent(roomId, olderThanMs = 60_000, now = Date.now()) {
      let removed = 0;
      await mutate(roomId, (box) => {
        const before = box.entries.length;
        box.entries = box.entries.filter((e) => {
          if (e.status !== "sent") return true;
          return now - e.createdAtMs < olderThanMs;
        });
        removed = before - box.entries.length;
        return box;
      });
      return removed;
    }
  };
}
