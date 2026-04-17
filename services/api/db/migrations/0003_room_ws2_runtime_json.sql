-- WS2 per-room ping decision history + projection recompute snapshot (JSON document).
CREATE TABLE IF NOT EXISTS room_ws2_runtime_json (
  room_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
