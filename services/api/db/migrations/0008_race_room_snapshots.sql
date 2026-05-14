-- Projection & sync hardening — materialized replay snapshots for race_room aggregates.
CREATE TABLE IF NOT EXISTS race_room_snapshots (
  aggregate_id TEXT PRIMARY KEY,
  last_sequence INT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
