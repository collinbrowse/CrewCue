-- HTTP idempotency cache (24h TTL enforced in application code).
CREATE TABLE IF NOT EXISTS http_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS http_idempotency_expires_at_idx ON http_idempotency (expires_at);
