-- Scope idempotency per HTTP operation (same key allowed on different routes).
ALTER TABLE http_idempotency DROP CONSTRAINT IF EXISTS http_idempotency_pkey;
ALTER TABLE http_idempotency ADD PRIMARY KEY (idempotency_key, method, path);
