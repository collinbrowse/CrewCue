-- Postgres & event log track — WS1 durable persistence (room invite)
-- Canonical DDL for room/invite JSON persistence tables used by roomPersistence.ts.

CREATE TABLE IF NOT EXISTS race_rooms_json (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_race_rooms_json_team_id ON race_rooms_json (team_id);

CREATE TABLE IF NOT EXISTS race_room_invites_json (
  token TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_race_room_invites_json_room_id ON race_room_invites_json (room_id);
