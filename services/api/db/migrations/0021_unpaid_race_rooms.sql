-- Unpaid races (runner and crew onboarding): POST /race-rooms refuses a 4th unpaid race per
-- creator, and an hourly sweeper deletes races still unpaid 30 days after they were created. Both
-- read only unpaid rooms through this partial index, so neither reads every paid room's payload
-- (it can carry the course GPX). Queries spell the predicate exactly as below, with 'unpaid' as a
-- literal, so Postgres can use it. "C" collation so the stored ISO-8601 UTC strings compare as
-- bytes, which is time order. Built once; IF NOT EXISTS makes every later deploy a no-op.
-- See services/api/src/lib/unpaidRaceExpiryScheduler.ts.
CREATE INDEX IF NOT EXISTS race_rooms_json_unpaid_created_at
  ON race_rooms_json ((payload->>'createdAt') COLLATE "C")
  WHERE payload->'entitlement'->>'status' = 'unpaid';
