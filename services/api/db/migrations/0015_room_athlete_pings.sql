-- Every accepted athlete location sample, so crews can draw the runner's path and the projection
-- can use the whole track. The primary key makes a replayed backlog upload idempotent.
CREATE TABLE IF NOT EXISTS room_athlete_pings (
  room_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  received_at TIMESTAMPTZ NOT NULL,
  ping_id TEXT NOT NULL,
  PRIMARY KEY (room_id, recorded_at)
);
