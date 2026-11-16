-- People the race owner removed from a room. Join by code refuses them; only a newer invite from
-- the owner lets them back in. Server-only: never part of the room payload clients read.
CREATE TABLE IF NOT EXISTS room_removed_members (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  removed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS room_removed_members_by_user ON room_removed_members (user_id);
