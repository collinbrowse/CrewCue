-- Tracking reminder pushes (runner and crew onboarding): one row per reminder claimed, so each
-- one goes out once across API instances. An instance inserts the row first and sends only when
-- its insert won (ON CONFLICT DO NOTHING). The race start is part of the key, so moving the start
-- re-arms both reminders. sent_at is the claim time. Rows go with the room (ON DELETE CASCADE);
-- the scheduler deletes rows older than 3 days. See services/api/src/lib/trackingReminderScheduler.ts.
CREATE TABLE IF NOT EXISTS tracking_reminders_sent (
  room_id TEXT NOT NULL REFERENCES race_rooms_json (id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('t45', 't5')),
  race_start_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (room_id, slot, race_start_at)
);

-- The scheduler's candidates: rooms whose start puts now inside a reminder window, found each minute.
-- "C" collation so the stored ISO-8601 UTC strings compare as bytes, which is time order.
CREATE INDEX IF NOT EXISTS race_rooms_json_race_start_at
  ON race_rooms_json ((payload->>'raceStartAt') COLLATE "C");
