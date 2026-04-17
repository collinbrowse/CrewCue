-- WS3 task board snapshot per race room (JSON document).
CREATE TABLE IF NOT EXISTS room_task_boards_json (
  room_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
