/**
 * Last-seen crew chat transcript per room (AsyncStorage). Lets the chat tab
 * paint immediately from the prior session while Stream/bootstrap catches up.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHAT_INITIAL_MESSAGE_COUNT } from "./chatMessageLimits";

const PREFIX = "crewcue.chat.transcript.v1.";

export type CachedChatTranscriptRow = {
  id: string;
  isOwn: boolean;
  authorUserId: string;
  authorDisplayName: string;
  authorAvatarUrl?: string;
  body: string | null;
  imageUrl?: string;
  sentAt: string;
  arrivedAt?: string;
  reactionCounts: Record<string, number>;
  isPending?: boolean;
  isFailed?: boolean;
  outboxId?: string;
};

type StoredEnvelope = {
  v: 1;
  savedAtMs: number;
  messages: CachedChatTranscriptRow[];
};

function key(roomId: string): string {
  return `${PREFIX}${roomId}`;
}

export async function loadTranscriptCache(roomId: string): Promise<CachedChatTranscriptRow[]> {
  try {
    const raw = await AsyncStorage.getItem(key(roomId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredEnvelope;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.messages)) return [];
    return parsed.messages;
  } catch {
    return [];
  }
}

function takeLastBySentAt(rows: CachedChatTranscriptRow[], max: number): CachedChatTranscriptRow[] {
  if (rows.length <= max) return rows;
  return [...rows]
    .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
    .slice(-max);
}

export async function saveTranscriptCache(roomId: string, messages: CachedChatTranscriptRow[]): Promise<void> {
  try {
    const trimmed = takeLastBySentAt(messages, CHAT_INITIAL_MESSAGE_COUNT);
    const env: StoredEnvelope = { v: 1, savedAtMs: Date.now(), messages: trimmed };
    await AsyncStorage.setItem(key(roomId), JSON.stringify(env));
  } catch {
    // best-effort cache
  }
}

export function chatViewMessagesToCacheRows(
  messages: Array<{
    id: string;
    isOwn: boolean;
    authorUserId: string;
    authorDisplayName: string;
    authorAvatarUrl?: string;
    body: string | null;
    imageUrl?: string;
    sentAt: Date;
    arrivedAt?: Date;
    reactionCounts: Record<string, number>;
    isPending?: boolean;
    isFailed?: boolean;
    outboxId?: string;
  }>
): CachedChatTranscriptRow[] {
  return messages.map((m) => ({
    id: m.id,
    isOwn: m.isOwn,
    authorUserId: m.authorUserId,
    authorDisplayName: m.authorDisplayName,
    authorAvatarUrl: m.authorAvatarUrl,
    body: m.body,
    imageUrl: m.imageUrl,
    sentAt: m.sentAt.toISOString(),
    arrivedAt: m.arrivedAt?.toISOString(),
    reactionCounts: { ...m.reactionCounts },
    isPending: m.isPending,
    isFailed: m.isFailed,
    outboxId: m.outboxId
  }));
}

export function cacheRowsToChatViewMessages(rows: CachedChatTranscriptRow[]): Array<{
  id: string;
  isOwn: boolean;
  authorUserId: string;
  authorDisplayName: string;
  authorAvatarUrl?: string;
  body: string | null;
  imageUrl?: string;
  sentAt: Date;
  arrivedAt?: Date;
  reactionCounts: Record<string, number>;
  isPending?: boolean;
  isFailed?: boolean;
  outboxId?: string;
}> {
  return rows.map((r) => ({
    id: r.id,
    isOwn: r.isOwn,
    authorUserId: r.authorUserId,
    authorDisplayName: r.authorDisplayName,
    authorAvatarUrl: r.authorAvatarUrl,
    body: r.body,
    imageUrl: r.imageUrl,
    sentAt: new Date(r.sentAt),
    arrivedAt: r.arrivedAt ? new Date(r.arrivedAt) : undefined,
    reactionCounts: { ...r.reactionCounts },
    isPending: r.isPending,
    isFailed: r.isFailed,
    outboxId: r.outboxId
  }));
}
