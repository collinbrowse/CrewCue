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
  shouldClaimOutboxSend,
  type ChatOutbox,
  type ChatOutboxEntry,
  type EnqueueChatMessageInput
} from "./messageQueueCore";

export type { ChatSendStatus, ChatOutboxEntry, ChatOutbox, EnqueueChatMessageInput } from "./messageQueueCore";
export {
  makeEntry,
  transitionEntry,
  shouldClaimOutboxSend,
  streamMessageIdForOutboxEntry,
  isDuplicateStreamMessageError
} from "./messageQueueCore";

const STORAGE_PREFIX = "crewcue.chat.outbox.";

/** Live in-process send claims — survives only for this JS runtime. */
const sendingInFlight = new Set<string>();

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

function flightKey(roomId: string, entryId: string): string {
  return `${roomId}\0${entryId}`;
}

/** Test helper — clears live send claims between cases. */
export function clearSendingInFlightForTests(): void {
  sendingInFlight.clear();
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
 * sent, or already claimed by a live in-process drain (Strict Mode / overlapping
 * effects). Persisted `sending` with no live owner is reclaimed so a crash
 * mid-send cannot strand the message forever.
 */
export async function markSending(roomId: string, entryId: string): Promise<boolean> {
  const key = flightKey(roomId, entryId);
  const box = await loadOutbox(roomId);
  const target = box.entries.find((e) => e.id === entryId);
  if (!target) return false;
  if (!shouldClaimOutboxSend(target.status, sendingInFlight.has(key))) return false;
  sendingInFlight.add(key);
  target.status = "sending";
  target.attempts += 1;
  delete target.lastError;
  try {
    await saveOutbox(box);
    return true;
  } catch (err) {
    sendingInFlight.delete(key);
    throw err;
  }
}

/** Drop the live claim after send settles (success, failure, or duplicate-id). */
export function releaseSendingClaim(roomId: string, entryId: string): void {
  sendingInFlight.delete(flightKey(roomId, entryId));
}

export async function markSent(roomId: string, entryId: string, remoteMessageId: string): Promise<void> {
  const box = await loadOutbox(roomId);
  const target = box.entries.find((e) => e.id === entryId);
  if (!target) return;
  target.status = "sent";
  target.remoteMessageId = remoteMessageId;
  await saveOutbox(box);
  releaseSendingClaim(roomId, entryId);
}

export async function markFailed(roomId: string, entryId: string, error: string): Promise<void> {
  const box = await loadOutbox(roomId);
  const target = box.entries.find((e) => e.id === entryId);
  if (!target) return;
  target.status = "failed";
  target.lastError = error;
  await saveOutbox(box);
  releaseSendingClaim(roomId, entryId);
}

export async function removeEntry(roomId: string, entryId: string): Promise<void> {
  const box = await loadOutbox(roomId);
  box.entries = box.entries.filter((e) => e.id !== entryId);
  await saveOutbox(box);
  releaseSendingClaim(roomId, entryId);
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
