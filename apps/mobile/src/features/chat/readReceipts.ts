/**
 * Pure helpers for the crew-chat “Read by everyone” footer.
 *
 * The footer must mean: every *other* Stream channel member has read through
 * the latest message *you* sent. Own markRead / solo channels / stale channel
 * state must never flip it on alone.
 */

export type ReadReceiptMemberMap = Record<string, unknown>;

export type ReadReceiptReadState = {
  last_read_message_id?: string | null;
  last_read?: Date | string | null;
};

export type ReadReceiptOwnMessage = {
  id: string;
  sentAtMs: number;
};

/**
 * Latest delivered own message (excludes pending outbox rows).
 */
export function latestDeliveredOwnMessage(
  messages: Array<{ id: string; isOwn: boolean; isPending?: boolean; isFailed?: boolean; sentAt: Date }>
): ReadReceiptOwnMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m?.isOwn) continue;
    if (m.isPending || m.isFailed) continue;
    if (m.id.startsWith("outbox-")) continue;
    const sentAtMs = m.sentAt.getTime();
    if (!Number.isFinite(sentAtMs)) continue;
    return { id: m.id, sentAtMs };
  }
  return undefined;
}

function peerHasReadThrough(
  readState: ReadReceiptReadState | undefined,
  latestOwn: ReadReceiptOwnMessage,
  messageIdsAtOrAfterOwn: Set<string>
): boolean {
  if (!readState) return false;
  const lastId = readState.last_read_message_id?.trim();
  if (lastId) {
    if (lastId === latestOwn.id) return true;
    // Peer read a later message in the same channel → they have read through ours.
    if (messageIdsAtOrAfterOwn.has(lastId)) return true;
    // Stale message id that is not at/after latest own → not read through yet.
    return false;
  }
  // Stream sometimes omits last_read_message_id and only sets last_read. With the
  // UI's latest delivered own message (not a stale channel.state row), timestamp
  // comparison is safe: peers who only watched before your send stay below it.
  if (!readState.last_read) return false;
  const lastReadMs = new Date(readState.last_read).getTime();
  return Number.isFinite(lastReadMs) && lastReadMs >= latestOwn.sentAtMs;
}

/**
 * True only when every other channel member has read through `latestOwn`.
 */
export function computeReadByEveryone(input: {
  members: ReadReceiptMemberMap;
  reads: Record<string, ReadReceiptReadState | undefined>;
  myStreamUserId: string;
  latestOwn: ReadReceiptOwnMessage | undefined;
  /** Message ids in the channel at or after `latestOwn` (including itself). */
  messageIdsAtOrAfterOwn: ReadonlySet<string>;
}): boolean {
  const { members, reads, myStreamUserId, latestOwn, messageIdsAtOrAfterOwn } = input;
  if (!latestOwn) return false;

  const otherMemberIds = Object.keys(members).filter((id) => id !== myStreamUserId);
  if (otherMemberIds.length === 0) return false;

  return otherMemberIds.every((id) =>
    peerHasReadThrough(reads[id], latestOwn, messageIdsAtOrAfterOwn as Set<string>)
  );
}

/**
 * Collect ids of messages whose created time is >= latest own (or id match).
 */
export function messageIdsAtOrAfter(
  messages: Array<{ id: string; sentAt: Date }>,
  latestOwn: ReadReceiptOwnMessage
): Set<string> {
  const out = new Set<string>([latestOwn.id]);
  for (const m of messages) {
    if (!m?.id || m.id.startsWith("outbox-")) continue;
    const t = m.sentAt.getTime();
    if (!Number.isFinite(t)) continue;
    if (t >= latestOwn.sentAtMs) out.add(m.id);
  }
  return out;
}
