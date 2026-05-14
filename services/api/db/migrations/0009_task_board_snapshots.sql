-- Projection & sync hardening — materialized snapshots for race room task board reads.
CREATE TABLE IF NOT EXISTS task_board_snapshots (
  aggregate_id TEXT PRIMARY KEY,
  version INT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
