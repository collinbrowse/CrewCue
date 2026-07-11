-- Prevent one user from claiming another user's push device id.
ALTER TABLE chat_push_devices
  DROP CONSTRAINT IF EXISTS chat_push_devices_pkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_push_devices_user_device_pkey'
      AND conrelid = 'chat_push_devices'::regclass
  ) THEN
    ALTER TABLE chat_push_devices
      ADD CONSTRAINT chat_push_devices_user_device_pkey PRIMARY KEY (user_id, device_id);
  END IF;
END $$;
