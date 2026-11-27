-- Chat photos uploaded but not yet attached to a message (ADR 0011). The upload route inserts a row
-- before it stores the bytes; sending a message with the photo deletes the row. The chat retention
-- scheduler deletes photos whose row is more than 24 hours old and that no message in the room
-- holds, then the row. A new, empty table: nothing to backfill. Mirrored in
-- services/api/src/lib/chatMessageStore.ts (initChatMessageStore).
CREATE TABLE IF NOT EXISTS chat_photo_uploads (
  photo_key TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_photo_uploads_uploaded_at ON chat_photo_uploads (uploaded_at);
