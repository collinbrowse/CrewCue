-- WS4 adaptive plan / incidents / recommendations snapshot per race room (JSON document).
CREATE TABLE IF NOT EXISTS room_ws4_adaptive_json (
  room_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
