-- Unpaid races (runner and crew onboarding): POST /race-rooms refuses a 4th unpaid race per
-- creator, and an hourly sweeper deletes races still unpaid 30 days after they were created. Both
-- read only unpaid rooms through these partial indexes, so neither reads any other room's payload
-- (it can carry the course GPX). Queries spell the predicate and the expressions exactly as below,
-- with 'unpaid' as a literal, so Postgres can use them. Built once; IF NOT EXISTS makes every
-- later deploy a no-op. See services/api/src/lib/unpaidRaceExpiryScheduler.ts.

-- The sweeper's candidates, by creation time. "C" collation so the stored ISO-8601 UTC strings
-- compare as bytes, which is time order.
CREATE INDEX IF NOT EXISTS race_rooms_json_unpaid_created_at
  ON race_rooms_json ((payload->>'createdAt') COLLATE "C")
  WHERE payload->'entitlement'->>'status' = 'unpaid';

-- The unpaid race limit's count, by creator: createdByUserId, else the first member (rooms
-- stored before #649), as billingEntitlement.ts raceCreatorOf reads it.
CREATE INDEX IF NOT EXISTS race_rooms_json_unpaid_creator
  ON race_rooms_json ((COALESCE(payload->>'createdByUserId', payload->'memberships'->0->>'userId')))
  WHERE payload->'entitlement'->>'status' = 'unpaid';
