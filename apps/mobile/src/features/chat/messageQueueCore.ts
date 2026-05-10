/**
 * Pure outbox transitions + entry factory (no SecureStore). Node unit tests
 * import from here so they never evaluate native storage.
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
