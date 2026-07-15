-- Drop practical-E2E chat crypto tables (MVP plaintext Stream chat).
DROP TABLE IF EXISTS chat_channel_envelopes CASCADE;
DROP TABLE IF EXISTS chat_room_crypto_state CASCADE;
DROP TABLE IF EXISTS chat_identity_backup CASCADE;
DROP TABLE IF EXISTS chat_user_identity CASCADE;
