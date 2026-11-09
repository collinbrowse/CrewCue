/**
 * Billing grant ledger (#649). Memory for PERSISTENCE_MODE=memory; Postgres when postgres.
 * Mirrors db/migrations/0019_billing_grants.sql.
 */
import { getPersistencePool } from "./roomPersistence.js";
import type { BillingGrant, BillingGrantSource } from "./billingEntitlement.js";

const BILLING_DDL = `
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
  CREATE TABLE IF NOT EXISTS billing_webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    transaction_id TEXT,
    room_id TEXT,
    outcome TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL
  );
`;

const memoryGrants = new Map<string, BillingGrant>();
const memoryEvents = new Map<string, { eventType: string; outcome: string }>();

let ready: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) return Promise.resolve();
  if (!ready) {
    ready = (async () => {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock(711649)");
        await client.query(BILLING_DDL);
      } finally {
        await client.query("SELECT pg_advisory_unlock(711649)");
        client.release();
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

type GrantRow = {
  transaction_id: string;
  room_id: string | null;
  product_id: string;
  app_user_id: string | null;
  source: BillingGrantSource;
  status: "active" | "revoked";
  store: string | null;
  environment: string | null;
  created_at: Date;
  updated_at: Date;
};

function fromRow(row: GrantRow): BillingGrant {
  return {
    transactionId: row.transaction_id,
    roomId: row.room_id,
    productId: row.product_id,
    appUserId: row.app_user_id,
    source: row.source,
    status: row.status,
    ...(row.store ? { store: row.store } : {}),
    ...(row.environment ? { environment: row.environment } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

/**
 * Record a webhook delivery by event id. Returns false when the event was already
 * recorded (a redelivery), so the caller acknowledges it without applying it again.
 */
export async function recordWebhookEvent(input: {
  eventId: string;
  eventType: string;
  transactionId?: string;
  roomId?: string;
  outcome: string;
  payload: unknown;
}): Promise<boolean> {
  await ensureReady();
  const pool = getPersistencePool();
  if (!pool) {
    if (memoryEvents.has(input.eventId)) return false;
    memoryEvents.set(input.eventId, { eventType: input.eventType, outcome: input.outcome });
    return true;
  }
  const result = await pool.query(
    `INSERT INTO billing_webhook_events (event_id, event_type, transaction_id, room_id, outcome, received_at, payload)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6::jsonb)
     ON CONFLICT (event_id) DO NOTHING`,
    [input.eventId, input.eventType, input.transactionId ?? null, input.roomId ?? null, input.outcome, JSON.stringify(input.payload ?? null)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateWebhookEventOutcome(eventId: string, outcome: string): Promise<void> {
  await ensureReady();
  const pool = getPersistencePool();
  if (!pool) {
    const existing = memoryEvents.get(eventId);
    if (existing) memoryEvents.set(eventId, { ...existing, outcome });
    return;
  }
  await pool.query(`UPDATE billing_webhook_events SET outcome = $2 WHERE event_id = $1`, [eventId, outcome]);
}

/** Forget a delivery so the store's retry can apply it (used when applying it failed). */
export async function forgetWebhookEvent(eventId: string): Promise<void> {
  await ensureReady();
  const pool = getPersistencePool();
  if (!pool) {
    memoryEvents.delete(eventId);
    return;
  }
  await pool.query(`DELETE FROM billing_webhook_events WHERE event_id = $1`, [eventId]);
}

/**
 * Insert or update one grant by transaction id. A second grant for the same
 * transaction is a no-op; `status` changes (refund, refund reversed) update in place.
 * Returns the stored grant and whether anything changed.
 */
export async function upsertBillingGrant(
  grant: Omit<BillingGrant, "createdAt" | "updatedAt">
): Promise<{ grant: BillingGrant; changed: boolean }> {
  await ensureReady();
  const now = new Date().toISOString();
  const pool = getPersistencePool();
  if (!pool) {
    const existing = memoryGrants.get(grant.transactionId);
    if (existing) {
      const roomId = existing.roomId ?? grant.roomId;
      if (existing.status === grant.status && existing.roomId === roomId) {
        return { grant: existing, changed: false };
      }
      const next = { ...existing, status: grant.status, roomId, updatedAt: now };
      memoryGrants.set(grant.transactionId, next);
      return { grant: next, changed: true };
    }
    const created: BillingGrant = { ...grant, createdAt: now, updatedAt: now };
    memoryGrants.set(grant.transactionId, created);
    return { grant: created, changed: true };
  }
  const inserted = await pool.query<GrantRow>(
    `INSERT INTO billing_grants
       (transaction_id, room_id, product_id, app_user_id, source, status, store, environment, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (transaction_id) DO NOTHING
     RETURNING *`,
    [
      grant.transactionId,
      grant.roomId,
      grant.productId,
      grant.appUserId,
      grant.source,
      grant.status,
      grant.store ?? null,
      grant.environment ?? null,
      now
    ]
  );
  if (inserted.rows[0]) {
    return { grant: fromRow(inserted.rows[0]), changed: true };
  }
  // Existing transaction: only a status change (or a first room id) is applied.
  const updated = await pool.query<GrantRow>(
    `UPDATE billing_grants
        SET status = $2, room_id = COALESCE(room_id, $3), updated_at = $4
      WHERE transaction_id = $1 AND (status <> $2 OR (room_id IS NULL AND $3::text IS NOT NULL))
      RETURNING *`,
    [grant.transactionId, grant.status, grant.roomId, now]
  );
  if (updated.rows[0]) {
    return { grant: fromRow(updated.rows[0]), changed: true };
  }
  const current = await pool.query<GrantRow>(`SELECT * FROM billing_grants WHERE transaction_id = $1`, [
    grant.transactionId
  ]);
  return { grant: fromRow(current.rows[0] as GrantRow), changed: false };
}

export async function listBillingGrantsForRoom(roomId: string): Promise<BillingGrant[]> {
  await ensureReady();
  const pool = getPersistencePool();
  if (!pool) {
    return [...memoryGrants.values()].filter((grant) => grant.roomId === roomId);
  }
  const result = await pool.query<GrantRow>(
    `SELECT * FROM billing_grants WHERE room_id = $1 ORDER BY created_at`,
    [roomId]
  );
  return result.rows.map(fromRow);
}

export async function getBillingGrant(transactionId: string): Promise<BillingGrant | undefined> {
  await ensureReady();
  const pool = getPersistencePool();
  if (!pool) return memoryGrants.get(transactionId);
  const result = await pool.query<GrantRow>(`SELECT * FROM billing_grants WHERE transaction_id = $1`, [transactionId]);
  return result.rows[0] ? fromRow(result.rows[0]) : undefined;
}

/**
 * Account deletion (#560): keep purchase records (refunds, store reconciliation) but drop
 * the link to the deleted user, including the raw webhook bodies that carry their id.
 * Returns how many grants were unlinked.
 */
export async function anonymizeBillingForUser(appUserId: string): Promise<number> {
  await ensureReady();
  const pool = getPersistencePool();
  if (!pool) {
    let count = 0;
    for (const [id, grant] of memoryGrants) {
      if (grant.appUserId === appUserId) {
        memoryGrants.set(id, { ...grant, appUserId: null });
        count += 1;
      }
    }
    return count;
  }
  const grants = await pool.query(`UPDATE billing_grants SET app_user_id = NULL WHERE app_user_id = $1`, [appUserId]);
  await pool.query(
    `UPDATE billing_webhook_events SET payload = '{}'::jsonb
      WHERE payload->'event'->>'app_user_id' = $1 OR payload->'event'->>'original_app_user_id' = $1`,
    [appUserId]
  );
  return grants.rowCount ?? 0;
}

export async function resetBillingStoreForTests(): Promise<void> {
  memoryGrants.clear();
  memoryEvents.clear();
  const pool = getPersistencePool();
  if (pool) {
    await ensureReady();
    await pool.query("TRUNCATE TABLE billing_grants");
    await pool.query("TRUNCATE TABLE billing_webhook_events");
  }
}
