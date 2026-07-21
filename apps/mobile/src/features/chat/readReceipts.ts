/**
 * Pure helpers for crew-chat read receipts on *own* messages.
 *
 * Indicators only apply to messages you sent. A delivered own message is
 * "read by everyone" when every other Stream channel member has read through
 * that message. Solo channels never show a receipt.
 */

export type ReadReceiptMemberMap = Record<string, unknown>;

export type ReadReceiptReadState = {
  last_read_message_id?: string | null;
  last_read?: Date | string | null;
};

export type ReadReceiptMessage = {
  id: string;
  isOwn: boolean;
  isPending?: boolean;
  isFailed?: boolean;
  sentAt: Date;
};

function deliveredOwnMessages(messages: ReadReceiptMessage[]): Array<{ id: string; sentAtMs: number }> {
  const out: Array<{ id: string; sentAtMs: number }> = [];
  for (const m of messages) {
    if (!m.isOwn || m.isPending || m.isFailed) continue;
    if (m.id.startsWith("outbox-")) continue;
    const sentAtMs = m.sentAt.getTime();
    if (!Number.isFinite(sentAtMs)) continue;
    out.push({ id: m.id, sentAtMs });
  }
  return out;
}

function peerHasReadThrough(
  readState: ReadReceiptReadState | undefined,
  target: { id: string; sentAtMs: number },
  messageIdsAtOrAfterTarget: ReadonlySet<string>
): boolean {
  if (!readState) return false;
  const lastId = readState.last_read_message_id?.trim();
  if (lastId) {
    if (lastId === target.id) return true;
    if (messageIdsAtOrAfterTarget.has(lastId)) return true;
    return false;
  }
  if (!readState.last_read) return false;
  const lastReadMs = new Date(readState.last_read).getTime();
  return Number.isFinite(lastReadMs) && lastReadMs >= target.sentAtMs;
}

function messageIdsAtOrAfter(
  messages: ReadReceiptMessage[],
  target: { id: string; sentAtMs: number }
): Set<string> {
  const out = new Set<string>([target.id]);
  for (const m of messages) {
    if (!m?.id || m.id.startsWith("outbox-")) continue;
    const t = m.sentAt.getTime();
    if (!Number.isFinite(t)) continue;
    if (t >= target.sentAtMs) out.add(m.id);
  }
  return out;
}

/**
 * Own delivered message ids that every *other* channel participant with a known
 * read frontier has read through.
 *
 * Peers are taken from `reads` (excluding self), not the full member roster —
 * otherwise never-opened crew seats permanently block receipts.
 */
export function computeOwnMessageIdsReadByEveryone(input: {
  members: ReadReceiptMemberMap;
  reads: Record<string, ReadReceiptReadState | undefined>;
  myStreamUserId: string;
  messages: ReadReceiptMessage[];
}): Set<string> {
  const { reads, myStreamUserId, messages } = input;
  const otherReaderIds = Object.keys(reads).filter((id) => id !== myStreamUserId && reads[id]);
  if (otherReaderIds.length === 0) return new Set();

  const own = deliveredOwnMessages(messages);
  const result = new Set<string>();
  for (const target of own) {
    const idsAtOrAfter = messageIdsAtOrAfter(messages, target);
    const everyone = otherReaderIds.every((id) =>
      peerHasReadThrough(reads[id], target, idsAtOrAfter)
    );
    if (everyone) result.add(target.id);
  }
  return result;
}

/**
 * Merge a Stream `message.read` event into a local read snapshot so UI updates
 * even if `channel.state.read` is slow to reflect the peer.
 */
export function applyMessageReadEvent(
  reads: Record<string, ReadReceiptReadState | undefined>,
  event: {
    user?: { id?: string } | null;
    last_read_message_id?: string | null;
    last_read?: Date | string | null;
    created_at?: Date | string | null;
  }
): Record<string, ReadReceiptReadState | undefined> {
  const userId = event.user?.id?.trim();
  if (!userId) return reads;
  const prev = reads[userId];
  const lastRead = event.last_read ?? event.created_at ?? prev?.last_read ?? new Date().toISOString();
  const lastId =
    (typeof event.last_read_message_id === "string" && event.last_read_message_id.trim()) ||
    prev?.last_read_message_id ||
    null;
  return {
    ...reads,
    [userId]: {
      last_read_message_id: lastId,
      last_read: lastRead
    }
  };
}

/** Snapshot `channel.state.read` into a plain object for React state. */
export function snapshotChannelReads(
  reads: Record<string, ReadReceiptReadState | undefined> | undefined
): Record<string, ReadReceiptReadState | undefined> {
  const out: Record<string, ReadReceiptReadState | undefined> = {};
  if (!reads) return out;
  for (const [id, row] of Object.entries(reads)) {
    if (!row) continue;
    out[id] = {
      last_read_message_id: row.last_read_message_id ?? null,
      last_read: row.last_read ?? null
    };
  }
  return out;
}
