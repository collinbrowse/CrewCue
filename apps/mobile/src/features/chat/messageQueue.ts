/**
 * Outbox-style queue for chat sends. Survives app restarts so a failed send
 * (network drop, app kill) can be retried unlimited times until the user
 * deletes it or it succeeds.
 *
 * SecureStore I/O uses a static import so Metro does not split a lazy chunk
 * that only loads on first chat navigation (see `chat/nativeDependencyPrewarm`).
 */
import * as SecureStore from "../../storage/secureStorage";
import {
  makeEntry,
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

export async function enqueueChatMessage(input: EnqueueChatMessageInput, now = Date.now()): Promise<ChatOutboxEntry> {
  const box = await loadOutbox(input.roomId);
  const entry = makeEntry(input, now);
  box.entries.push(entry);
  await saveOutbox(box);
  return entry;
}

/**
 * Marks an entry as sending. Returns false if the entry is missing, already
 * sending, or already sent — avoids duplicate Stream sends when React Strict
 * Mode or overlapping effects invoke the outbox drain twice.
 */
export async function markSending(roomId: string, entryId: string): Promise<boolean> {
  const box = await loadOutbox(roomId);
  const target = box.entries.find((e) => e.id === entryId);
  if (!target) return false;
  if (target.status === "sending" || target.status === "sent") return false;
  target.status = "sending";
  target.attempts += 1;
  delete target.lastError;
  await saveOutbox(box);
  return true;
}

export async function markSent(roomId: string, entryId: string, remoteMessageId: string): Promise<void> {
  const box = await loadOutbox(roomId);
  const target = box.entries.find((e) => e.id === entryId);
  if (!target) return;
  target.status = "sent";
  target.remoteMessageId = remoteMessageId;
  await saveOutbox(box);
}

export async function markFailed(roomId: string, entryId: string, error: string): Promise<void> {
  const box = await loadOutbox(roomId);
  const target = box.entries.find((e) => e.id === entryId);
  if (!target) return;
  target.status = "failed";
  target.lastError = error;
  await saveOutbox(box);
}

export async function removeEntry(roomId: string, entryId: string): Promise<void> {
  const box = await loadOutbox(roomId);
  box.entries = box.entries.filter((e) => e.id !== entryId);
  await saveOutbox(box);
}

export async function reapSent(roomId: string, olderThanMs = 60_000, now = Date.now()): Promise<number> {
  const box = await loadOutbox(roomId);
  const before = box.entries.length;
  box.entries = box.entries.filter((e) => {
    if (e.status !== "sent") return true;
    return now - e.createdAtMs < olderThanMs;
  });
  await saveOutbox(box);
  return before - box.entries.length;
}
