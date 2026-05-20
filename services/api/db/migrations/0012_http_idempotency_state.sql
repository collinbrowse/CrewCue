-- Claim-before-mutate idempotency: processing rows block duplicate in-flight work.
ALTER TABLE http_idempotency ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE http_idempotency DROP CONSTRAINT IF EXISTS http_idempotency_state_check;
ALTER TABLE http_idempotency ADD CONSTRAINT http_idempotency_state_check CHECK (state IN ('processing', 'complete'));
