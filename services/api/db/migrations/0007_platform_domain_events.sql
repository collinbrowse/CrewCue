-- WS7 append-only platform domain events (per ADR 0003 direction).
CREATE TABLE IF NOT EXISTS platform_aggregate_heads (
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  last_sequence INT NOT NULL DEFAULT 0,
  PRIMARY KEY (aggregate_type, aggregate_id)
);

CREATE TABLE IF NOT EXISTS platform_domain_events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  sequence INT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  schema_version TEXT NOT NULL,
  transport TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  correlation_id TEXT,
  causation_id TEXT,
  UNIQUE (aggregate_type, aggregate_id, sequence)
);

CREATE INDEX IF NOT EXISTS platform_domain_events_by_aggregate
  ON platform_domain_events (aggregate_type, aggregate_id);
