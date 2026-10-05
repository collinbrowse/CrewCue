/**
 * Outbox-style queue for chat sends. Survives app restarts so a failed send
 * (network drop, app kill) can be retried unlimited times until the user
 * deletes it or it succeeds.
 *
 * SecureStore I/O uses a static import so Metro does not split a lazy chunk
 * that only loads on first chat navigation (see `chat/nativeDependencyPrewarm`).
 *
 * Mutations for one room share a lock. Overlapping load-modify-save used to
 * drop a message enqueued while another send was marking itself sent.
 */
import * as SecureStore from "../../storage/secureStorage";
import { createChatOutboxController } from "./messageQueueLock";
import {
  type ChatOutbox,
  type ChatOutboxEntry,
  type EnqueueChatMessageInput
} from "./messageQueueCore";

export type { ChatSendStatus, ChatOutboxEntry, ChatOutbox, EnqueueChatMessageInput } from "./messageQueueCore";
export { makeEntry, transitionEntry } from "./messageQueueCore";

const STORAGE_PREFIX = "crewcue.chat.outbox.";

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

export async function loadOutbox(roomId: string): Promise<ChatOutbox> {
  const raw = await SecureStore.getItemAsync(storageKey(roomId));
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

async function saveOutbox(box: ChatOutbox): Promise<void> {
  if (box.entries.length === 0) {
    await SecureStore.deleteItemAsync(storageKey(box.roomId));
    return;
  }
  await SecureStore.setItemAsync(storageKey(box.roomId), JSON.stringify(box));
}

const controllers = new Map<string, ReturnType<typeof createChatOutboxController>>();

function controllerFor(roomId: string): ReturnType<typeof createChatOutboxController> {
  const existing = controllers.get(roomId);
  if (existing) {
    return existing;
  }
  const created = createChatOutboxController({
    read: () => loadOutbox(roomId),
    write: (box) => saveOutbox(box)
  });
  controllers.set(roomId, created);
  return created;
}

export async function enqueueChatMessage(input: EnqueueChatMessageInput, now = Date.now()): Promise<ChatOutboxEntry> {
  return controllerFor(input.roomId).enqueue(input, now);
}

/**
 * Marks an entry as sending. Returns false if the entry is missing, already
 * sending, or already sent — avoids duplicate Stream sends when React Strict
 * Mode or overlapping effects invoke the outbox drain twice.
 */
export async function markSending(roomId: string, entryId: string): Promise<boolean> {
  return controllerFor(roomId).markSending(entryId);
}

export async function markSent(roomId: string, entryId: string, remoteMessageId: string): Promise<void> {
  await controllerFor(roomId).markSent(entryId, remoteMessageId);
}

export async function markFailed(roomId: string, entryId: string, error: string): Promise<void> {
  await controllerFor(roomId).markFailed(entryId, error);
}

export async function removeEntry(roomId: string, entryId: string): Promise<void> {
  await controllerFor(roomId).removeEntry(entryId);
}

export async function reapSent(roomId: string, olderThanMs = 60_000, now = Date.now()): Promise<number> {
  return controllerFor(roomId).reapSent(olderThanMs, now);
}
