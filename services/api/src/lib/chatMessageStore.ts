/**
 * Crew chat message storage (ADR 0011). Postgres in production, a Map in memory mode.
 *
 * Message ids are the table's bigserial `seq` as a decimal string, so they double as the
 * paging cursor. A retry with the same (room, sender, clientMessageId) returns the stored
 * row instead of inserting a second one.
 */
import { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";

type Mode = "memory" | "postgres";

function resolveMode(): Mode {
  const raw = process.env.PERSISTENCE_MODE;
  if (!raw || raw === "memory") return "memory";
  if (raw === "postgres") return "postgres";
  throw new Error(`Invalid PERSISTENCE_MODE '${raw}'.`);
}

const pool = resolveMode() === "postgres" ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

export type StoredChatMessage = {
  seq: number;
  roomId: string;
  senderUserId: string;
  clientMessageId: string;
  text: string;
  photoKey?: string;
  photoContentType?: string;
  photoByteSize?: number;
  createdAt: string;
};

export type NewChatMessage = Omit<StoredChatMessage, "seq" | "createdAt">;

const memoryMessages: StoredChatMessage[] = [];
let memorySeq = 0;
let initialized = false;
let initPromise: Promise<void> | null = null;

export async function initChatMessageStore(log?: FastifyBaseLogger): Promise<void> {
  if (!pool || initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(711201)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          seq BIGSERIAL PRIMARY KEY,
          room_id TEXT NOT NULL,
          sender_user_id TEXT NOT NULL,
          client_message_id TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          photo_key TEXT,
          photo_content_type TEXT,
          photo_byte_size INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (room_id, sender_user_id, client_message_id)
        );
      `);
      await client.query(
        "CREATE INDEX IF NOT EXISTS chat_messages_room_seq ON chat_messages (room_id, seq);"
      );
    } finally {
      await client.query("SELECT pg_advisory_unlock(711201)");
      client.release();
    }
    initialized = true;
    log?.info({ chatMessages: { mode: "postgres" } }, "chat_message_store_ready");
  })();
  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

type Row = {
  seq: string;
  room_id: string;
  sender_user_id: string;
  client_message_id: string;
  body: string;
  photo_key: string | null;
  photo_content_type: string | null;
  photo_byte_size: number | null;
  created_at: Date | string;
};

function fromRow(row: Row): StoredChatMessage {
  return {
    seq: Number(row.seq),
    roomId: row.room_id,
    senderUserId: row.sender_user_id,
    clientMessageId: row.client_message_id,
    text: row.body,
    ...(row.photo_key
      ? {
          photoKey: row.photo_key,
          photoContentType: row.photo_content_type ?? "image/jpeg",
          photoByteSize: row.photo_byte_size ?? 0
        }
      : {}),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  };
}

// `seq` comes back as text, so a bare `ORDER BY seq` sorts the text alias ("100" before "99").
// Order by `chat_messages.seq` to sort the numeric column.
const COLUMNS =
  "seq::text AS seq, room_id, sender_user_id, client_message_id, body, photo_key, photo_content_type, photo_byte_size, created_at";

/** Stores a message, or returns the one already stored under the same client message id. */
export async function insertChatMessage(
  input: NewChatMessage
): Promise<{ message: StoredChatMessage; duplicate: boolean }> {
  if (!pool) {
    const existing = memoryMessages.find(
      (m) =>
        m.roomId === input.roomId &&
        m.senderUserId === input.senderUserId &&
        m.clientMessageId === input.clientMessageId
    );
    if (existing) return { message: structuredClone(existing), duplicate: true };
    memorySeq += 1;
    const stored: StoredChatMessage = { ...input, seq: memorySeq, createdAt: new Date().toISOString() };
    memoryMessages.push(stored);
    return { message: structuredClone(stored), duplicate: false };
  }
  await initChatMessageStore();
  const inserted = await pool.query<Row>(
    `
      INSERT INTO chat_messages
        (room_id, sender_user_id, client_message_id, body, photo_key, photo_content_type, photo_byte_size)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (room_id, sender_user_id, client_message_id) DO NOTHING
      RETURNING ${COLUMNS};
    `,
    [
      input.roomId,
      input.senderUserId,
      input.clientMessageId,
      input.text,
      input.photoKey ?? null,
      input.photoContentType ?? null,
      input.photoByteSize ?? null
    ]
  );
  if (inserted.rows[0]) return { message: fromRow(inserted.rows[0]), duplicate: false };
  const existing = await pool.query<Row>(
    `SELECT ${COLUMNS} FROM chat_messages WHERE room_id = $1 AND sender_user_id = $2 AND client_message_id = $3`,
    [input.roomId, input.senderUserId, input.clientMessageId]
  );
  const row = existing.rows[0];
  if (!row) throw new Error("chat message conflict without a stored row");
  return { message: fromRow(row), duplicate: true };
}

export type ChatMessageQuery = {
  roomId: string;
  limit: number;
  /** Only messages with seq > after, oldest first. */
  after?: number;
  /** Only messages with seq < before (the newest `limit` of them), oldest first. */
  before?: number;
};

/** Oldest first. Without `after`, returns the newest `limit` messages (before `before` when set). */
export async function listChatMessages(query: ChatMessageQuery): Promise<StoredChatMessage[]> {
  if (!pool) {
    const inRoom = memoryMessages.filter((m) => m.roomId === query.roomId);
    if (query.after !== undefined) {
      const after = query.after;
      return structuredClone(inRoom.filter((m) => m.seq > after).slice(0, query.limit));
    }
    const before = query.before;
    const older = before === undefined ? inRoom : inRoom.filter((m) => m.seq < before);
    return structuredClone(older.slice(-query.limit));
  }
  await initChatMessageStore();
  if (query.after !== undefined) {
    const result = await pool.query<Row>(
      `SELECT ${COLUMNS} FROM chat_messages WHERE room_id = $1 AND seq > $2 ORDER BY chat_messages.seq ASC LIMIT $3`,
      [query.roomId, query.after, query.limit]
    );
    return result.rows.map(fromRow);
  }
  const result = await pool.query<Row>(
    `
      SELECT ${COLUMNS} FROM chat_messages
      WHERE room_id = $1 AND ($2::bigint IS NULL OR seq < $2::bigint)
      ORDER BY chat_messages.seq DESC LIMIT $3
    `,
    [query.roomId, query.before ?? null, query.limit]
  );
  return result.rows.map(fromRow).reverse();
}

/** True when the room has a message older than `seq`. */
export async function hasChatMessageBefore(roomId: string, seq: number): Promise<boolean> {
  if (!pool) {
    return memoryMessages.some((m) => m.roomId === roomId && m.seq < seq);
  }
  await initChatMessageStore();
  const result = await pool.query(
    "SELECT 1 FROM chat_messages WHERE room_id = $1 AND seq < $2 LIMIT 1",
    [roomId, seq]
  );
  return (result.rowCount ?? 0) > 0;
}

/** The newest message seq in the room, or undefined when it has none. */
export async function latestChatMessageSeq(roomId: string): Promise<number | undefined> {
  if (!pool) {
    const inRoom = memoryMessages.filter((m) => m.roomId === roomId);
    return inRoom.at(-1)?.seq;
  }
  await initChatMessageStore();
  const result = await pool.query<{ seq: string | null }>(
    "SELECT MAX(seq)::text AS seq FROM chat_messages WHERE room_id = $1",
    [roomId]
  );
  const seq = result.rows[0]?.seq;
  return seq ? Number(seq) : undefined;
}

/** Deletes every message in the room. Returns the deleted messages' photo keys. */
export async function deleteChatMessagesForRoom(
  roomId: string
): Promise<{ messagesPurged: number; photoKeys: string[] }> {
  if (!pool) {
    const keep = memoryMessages.filter((m) => m.roomId !== roomId);
    const removed = memoryMessages.filter((m) => m.roomId === roomId);
    memoryMessages.splice(0, memoryMessages.length, ...keep);
    return {
      messagesPurged: removed.length,
      photoKeys: removed.flatMap((m) => (m.photoKey ? [m.photoKey] : []))
    };
  }
  await initChatMessageStore();
  const result = await pool.query<{ photo_key: string | null }>(
    "DELETE FROM chat_messages WHERE room_id = $1 RETURNING photo_key",
    [roomId]
  );
  return {
    messagesPurged: result.rowCount ?? 0,
    photoKeys: result.rows.flatMap((r) => (r.photo_key ? [r.photo_key] : []))
  };
}

/** Account deletion: every message this user sent, in any room. Returns their photo keys. */
export async function deleteChatMessagesBySender(
  senderUserId: string
): Promise<{ messagesPurged: number; photoKeys: string[] }> {
  if (!pool) {
    const removed = memoryMessages.filter((m) => m.senderUserId === senderUserId);
    const keep = memoryMessages.filter((m) => m.senderUserId !== senderUserId);
    memoryMessages.splice(0, memoryMessages.length, ...keep);
    return {
      messagesPurged: removed.length,
      photoKeys: removed.flatMap((m) => (m.photoKey ? [m.photoKey] : []))
    };
  }
  await initChatMessageStore();
  const result = await pool.query<{ photo_key: string | null }>(
    "DELETE FROM chat_messages WHERE sender_user_id = $1 RETURNING photo_key",
    [senderUserId]
  );
  return {
    messagesPurged: result.rowCount ?? 0,
    photoKeys: result.rows.flatMap((r) => (r.photo_key ? [r.photo_key] : []))
  };
}

/** Test-only: clear memory state. No-op against postgres. */
export function _resetChatMessageStoreForTests(): void {
  if (pool) return;
  memoryMessages.splice(0, memoryMessages.length);
}
