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

/**
 * Whether `markSending` may claim this entry.
 *
 * Persisted `sending` without a live in-process owner is reclaimable (process
 * death mid-send). Live overlapping drains (Strict Mode / double effects) pass
 * `liveInFlight=true` and must not reclaim.
 */
export function shouldClaimOutboxSend(
  status: ChatSendStatus,
  liveInFlight: boolean
): boolean {
  if (status === "sent") return false;
  if (liveInFlight) return false;
  return status === "pending" || status === "failed" || status === "sending";
}

/** Stable Stream message id so a reclaim retry does not create a second message. */
export function streamMessageIdForOutboxEntry(entryId: string): string {
  // Stream: max 255 chars; cannot contain `,` or `%`.
  const cleaned = entryId.replace(/[,%]/g, "_");
  return `ccq-${cleaned}`.slice(0, 255);
}

/** Stream returns 4xx when the client-supplied message id already exists. */
export function isDuplicateStreamMessageError(error: unknown): boolean {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.message);
    const anyErr = error as Error & {
      code?: unknown;
      status?: unknown;
      response?: { data?: { code?: unknown; message?: unknown } };
    };
    if (anyErr.code != null) parts.push(String(anyErr.code));
    if (anyErr.status != null) parts.push(String(anyErr.status));
    const dataMsg = anyErr.response?.data?.message;
    if (typeof dataMsg === "string") parts.push(dataMsg);
    const dataCode = anyErr.response?.data?.code;
    if (dataCode != null) parts.push(String(dataCode));
  } else if (typeof error === "string") {
    parts.push(error);
  } else if (error && typeof error === "object") {
    const o = error as { message?: unknown; code?: unknown };
    if (typeof o.message === "string") parts.push(o.message);
    if (o.code != null) parts.push(String(o.code));
  }
  const haystack = parts.join(" ").toLowerCase();
  if (haystack.includes("already exists") && haystack.includes("message")) return true;
  // Stream API error code 4 is commonly used for duplicate / conflict message ids.
  if (/(^|\s)4(\s|$)/.test(haystack) && haystack.includes("already exists")) return true;
  return false;
}
