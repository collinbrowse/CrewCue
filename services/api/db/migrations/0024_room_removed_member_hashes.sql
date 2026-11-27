-- Room removals of people who deleted their account. Account deletion moves their
-- room_removed_members rows here with the user id replaced by a keyed hash (HMAC-SHA256 under
-- ROOM_REMOVAL_HASH_KEY), so the removal still applies if the same sign-in comes back, without
-- keeping the raw id. Server-only, like room_removed_members.
CREATE TABLE IF NOT EXISTS room_removed_member_hashes (
  room_id TEXT NOT NULL,
  user_hash TEXT NOT NULL,
  removed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (room_id, user_hash)
);
