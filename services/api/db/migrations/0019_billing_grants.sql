-- Store purchases and admin comps recorded against race rooms (#649).
-- One row per store transaction; a refund flips status to revoked and keeps the row.
-- room_id is null when the webhook named no room or an unknown one (stored for support, never applied).
CREATE TABLE IF NOT EXISTS billing_grants (
  transaction_id TEXT PRIMARY KEY,
  room_id TEXT,
  product_id TEXT NOT NULL,
  app_user_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('revenuecat', 'admin_comp', 'dev_fake')),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  store TEXT,
  environment TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_grants_by_room ON billing_grants (room_id);

-- Every RevenueCat delivery by event id, so a redelivered event is acknowledged without being applied twice.
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  transaction_id TEXT,
  room_id TEXT,
  outcome TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
