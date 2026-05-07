/**
 * Outbox-style queue for chat sends. Survives app restarts so a failed send
 * (network drop, app kill) can be retried unlimited times until the user
 * deletes it or it succeeds.
 *
 * This module is split into:
 *   - pure transitions (`makeEntry`, `transitionEntry`) usable by Node tests
 *   - SecureStore-backed I/O (everything async) loaded lazily so unit tests
 *     do not need to evaluate `react-native` to exercise the queue logic.
 */

export type ChatSendStatus = "pending" | "sending" | "sent" | "failed";

export type ChatOutboxEntry = {
  id: string;
  roomId: string;
  body: string;
  attachmentUri?: string;
  attachmentMimeType?: string;
  mentionedUserIds: string[];
  createdAtMs: number;
  status: ChatSendStatus;
  attempts: number;
  lastError?: string;
  /** Server-confirmed message id once the entry is `sent`. */
  remoteMessageId?: string;
};

export type ChatOutbox = {
  roomId: string;
  entries: ChatOutboxEntry[];
};

const STORAGE_PREFIX = "crewcue.chat.outbox.";

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

async function getSecureStore() {
  return import("../../storage/secureStorage");
}

export async function loadOutbox(roomId: string): Promise<ChatOutbox> {
  const { getItemAsync } = await getSecureStore();
  const raw = await getItemAsync(storageKey(roomId));
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
  const { deleteItemAsync, setItemAsync } = await getSecureStore();
  if (box.entries.length === 0) {
    await deleteItemAsync(storageKey(box.roomId));
    return;
  }
  await setItemAsync(storageKey(box.roomId), JSON.stringify(box));
}

export type EnqueueChatMessageInput = {
  roomId: string;
  body: string;
  attachmentUri?: string;
  attachmentMimeType?: string;
  mentionedUserIds?: string[];
};

export function makeEntry(input: EnqueueChatMessageInput, now = Date.now(), id?: string): ChatOutboxEntry {
  return {
    id: id ?? makeEntryId(now),
    roomId: input.roomId,
    body: input.body,
    attachmentUri: input.attachmentUri,
    attachmentMimeType: input.attachmentMimeType,
    mentionedUserIds: input.mentionedUserIds ?? [],
    createdAtMs: now,
    status: "pending",
    attempts: 0
  };
}

function makeEntryId(now: number): string {
  return `${now}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueChatMessage(
  input: EnqueueChatMessageInput,
  now = Date.now()
): Promise<ChatOutboxEntry> {
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

export async function markSent(
  roomId: string,
  entryId: string,
  remoteMessageId: string
): Promise<void> {
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

/** Apply outbox transitions in pure-functional form for unit testing. */
export function transitionEntry(
  entry: ChatOutboxEntry,
  action:
    | { kind: "send_started" }
    | { kind: "send_succeeded"; remoteMessageId: string }
    | { kind: "send_failed"; error: string }
): ChatOutboxEntry {
  switch (action.kind) {
    case "send_started":
      return { ...entry, status: "sending", attempts: entry.attempts + 1, lastError: undefined };
    case "send_succeeded":
      return {
        ...entry,
        status: "sent",
        remoteMessageId: action.remoteMessageId,
        lastError: undefined
      };
    case "send_failed":
      return { ...entry, status: "failed", lastError: action.error };
    default:
      return entry;
  }
}
