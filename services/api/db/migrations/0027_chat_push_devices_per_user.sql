-- Push device rows keyed per user: (user_id, device_id) instead of device_id alone, so a
-- registration only ever writes the caller's own row, and `DELETE /chat/devices/:deviceId`
-- (sign-out) removes only the caller's row. Existing rows already have unique device_id values,
-- so they fit the new key as they are. Runs on every deploy: the key is swapped only while the
-- primary key is still the single device_id column, so later runs change nothing.
-- Mirrored in services/api/src/lib/chatPersistence.ts (initChatPersistence).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE t.relname = 'chat_push_devices'
      AND i.indisprimary
      AND i.indnatts = 1
  ) THEN
    ALTER TABLE chat_push_devices DROP CONSTRAINT chat_push_devices_pkey;
    ALTER TABLE chat_push_devices ADD PRIMARY KEY (user_id, device_id);
  END IF;
END
$$;

-- Registration drops any other row holding the same token (the phone now belongs to whoever
-- registered it last), and provider rejections delete by (device_id, token).
CREATE INDEX IF NOT EXISTS chat_push_devices_token
  ON chat_push_devices (token);
