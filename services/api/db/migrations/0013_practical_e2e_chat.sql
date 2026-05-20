-- Practical E2E crew chat: user-scoped identity, backups, envelopes; push devices separate.
-- No live chat users — replaces prior device-centric chat crypto tables.

DROP TABLE IF EXISTS chat_channel_envelopes CASCADE;
DROP TABLE IF EXISTS chat_device_keys CASCADE;
DROP TABLE IF EXISTS chat_push_tokens CASCADE;

CREATE TABLE IF NOT EXISTS chat_user_identity (
  user_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_identity_backup (
  user_id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_room_crypto_state (
  room_id TEXT PRIMARY KEY,
  latest_key_version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_channel_envelopes (
  room_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  sender_ephemeral_public_key TEXT NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, recipient_user_id, key_version)
);

CREATE INDEX IF NOT EXISTS chat_channel_envelopes_room_version
  ON chat_channel_envelopes (room_id, key_version DESC);

CREATE TABLE IF NOT EXISTS chat_push_devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  token TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_push_devices_user
  ON chat_push_devices (user_id);
