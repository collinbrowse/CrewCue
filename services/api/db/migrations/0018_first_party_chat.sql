-- First-party crew chat (ADR 0010): messages in our Postgres, replacing Stream.
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

CREATE INDEX IF NOT EXISTS chat_messages_room_seq ON chat_messages (room_id, seq);

-- iOS tokens from debug builds belong to the APNs development gateway.
ALTER TABLE chat_push_devices ADD COLUMN IF NOT EXISTS apns_environment TEXT;
