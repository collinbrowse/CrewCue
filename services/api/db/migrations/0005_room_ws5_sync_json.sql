-- WS5 sync telemetry snapshot per race room (JSON document).
CREATE TABLE IF NOT EXISTS room_ws5_sync_json (
  room_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
