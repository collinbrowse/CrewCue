-- Unpaid-race reminder pushes (runner and crew onboarding): one row per reminder claimed, so each
-- one goes out once across API instances. An instance inserts the row first and sends only when
-- its insert won (ON CONFLICT DO NOTHING). Slots: expiry_7d, expiry_1d, race_soon. claimed_at is
-- the claim time; the 30-day sweeper deletes a race only once its expiry_1d row is at least 24
-- hours old. Rows go with the room (ON DELETE CASCADE). A new, empty table: nothing to backfill.
-- See services/api/src/lib/unpaidRaceReminderScheduler.ts.
CREATE TABLE IF NOT EXISTS unpaid_reminders_sent (
  room_id TEXT NOT NULL REFERENCES race_rooms_json (id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('expiry_7d', 'expiry_1d', 'race_soon')),
  claimed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (room_id, slot)
);

-- The race_soon candidates: unpaid races starting within 3 days, found every 15 minutes. Partial,
-- like the 0021 indexes, so it holds unpaid rooms only and the tick never reads a paid room's
-- payload (it can carry the course GPX). Queries spell the predicate and the expression exactly as
-- below, with 'unpaid' as a literal. Built once; IF NOT EXISTS makes every later deploy a no-op.
-- "C" collation so the stored ISO-8601 UTC strings compare as bytes, which is time order.
CREATE INDEX IF NOT EXISTS race_rooms_json_unpaid_race_start_at
  ON race_rooms_json ((payload->>'raceStartAt') COLLATE "C")
  WHERE payload->'entitlement'->>'status' = 'unpaid';
