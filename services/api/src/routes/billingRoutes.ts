/**
 * Billing (#649): RevenueCat webhook, the room billing view the apps poll, the
 * admin comp, and the debug fake purchase.
 *
 * Purchases are consumables attached to one race room. The webhook is the only
 * production path that marks a room paid; the apps never mark it themselves.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import type { RaceRoom } from "@crewcue/contracts";
import {
  billingViewOf,
  entitlementFromGrants,
  isBillingProductId,
  parseRevenueCatEvent,
  type BillingGrant
} from "../lib/billingEntitlement.js";
import { isManualBillingAllowed } from "../lib/billingEnv.js";
import {
  forgetWebhookEvent,
  listBillingGrantsForRoom,
  recordWebhookEvent,
  updateWebhookEventOutcome,
  upsertBillingGrant
} from "../lib/billingStore.js";
import { commitRaceRoomUpdateAsync, getRaceRoom } from "./raceRooms.js";

export const BILLING_ADMIN_SECRET_HEADER = "x-crewcue-billing-admin-secret";

function secretMatches(expected: string | undefined, provided: string | string[] | undefined): boolean {
  const want = expected?.trim();
  const got = Array.isArray(provided) ? provided[0] : provided;
  if (!want || !got) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(got.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Apply one grant and recompute the room's entitlement from all of its grants,
 * under the room lock so it serializes with joins and other grants.
 * Returns the updated room, or undefined when the room does not exist.
 */
export async function applyBillingGrant(
  grant: Omit<BillingGrant, "createdAt" | "updatedAt">,
  log: FastifyBaseLogger
): Promise<{ room?: RaceRoom; changed: boolean }> {
  const { changed } = await upsertBillingGrant(grant);
  if (!grant.roomId) {
    return { changed };
  }
  const room = await commitRaceRoomUpdateAsync(grant.roomId, async (latest) => {
    const grants = await listBillingGrantsForRoom(latest.id);
    const entitlement = entitlementFromGrants(grants, new Date().toISOString());
    return entitlement ? { ...latest, entitlement } : latest;
  });
  if (room) {
    log.info(
      {
        billing: {
          roomId: room.id,
          transactionId: grant.transactionId,
          productId: grant.productId,
          source: grant.source,
          grantStatus: grant.status,
          entitlementStatus: room.entitlement.status,
          crewTier: room.entitlement.crewTier
        }
      },
      "billing_grant_applied"
    );
  }
  return { room, changed };
}

const compInput = z.object({
  roomId: z.string().trim().min(1),
  unlimited: z.boolean().optional()
});

const devPurchaseInput = z.object({
  productId: z.string().refine(isBillingProductId, "Unknown product")
});

export async function billingRoutes(app: FastifyInstance) {
  /**
   * RevenueCat webhook. RevenueCat sends the configured authorization value verbatim
   * in the Authorization header. Idempotent on event id (redelivery) and on
   * transaction id (the same purchase reported twice).
   */
  app.post("/billing/revenuecat", async (request, reply) => {
    const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
    if (!expected?.trim()) {
      request.log.error("billing_webhook_not_configured");
      return reply.code(503).send({ error: "Billing webhook not configured" });
    }
    if (!secretMatches(expected, request.headers.authorization)) {
      request.log.warn("billing_webhook_bad_secret");
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const event = parseRevenueCatEvent(request.body);
    if (!event) {
      return reply.code(400).send({ error: "Invalid webhook payload" });
    }

    const fresh = await recordWebhookEvent({
      eventId: event.eventId,
      eventType: event.type,
      transactionId: event.transactionId,
      roomId: event.roomId,
      outcome: "received",
      payload: request.body
    });
    if (!fresh) {
      request.log.info({ billing: { eventId: event.eventId, type: event.type } }, "billing_webhook_duplicate");
      return reply.send({ ok: true, duplicate: true });
    }

    if (event.action === "ignore" || !event.transactionId || !event.productId) {
      await updateWebhookEventOutcome(event.eventId, "ignored");
      return reply.send({ ok: true, ignored: true });
    }

    const knownRoom = event.roomId ? await getRaceRoom(event.roomId) : undefined;
    if (!knownRoom) {
      // Kept for support (the runner paid; a person can attach it) but never applied.
      await upsertBillingGrant({
        transactionId: event.transactionId,
        roomId: null,
        productId: event.productId,
        appUserId: event.appUserId ?? null,
        source: "revenuecat",
        status: event.action === "grant" ? "active" : "revoked",
        store: event.store,
        environment: event.environment
      });
      await updateWebhookEventOutcome(event.eventId, "unknown_room");
      request.log.warn(
        {
          billing: {
            eventId: event.eventId,
            transactionId: event.transactionId,
            productId: event.productId,
            roomId: event.roomId ?? null,
            appUserId: event.appUserId ?? null
          }
        },
        "billing_webhook_unknown_room"
      );
      return reply.send({ ok: true, unknownRoom: true });
    }

    try {
      const { room, changed } = await applyBillingGrant(
        {
          transactionId: event.transactionId,
          roomId: knownRoom.id,
          productId: event.productId,
          appUserId: event.appUserId ?? null,
          source: "revenuecat",
          status: event.action === "grant" ? "active" : "revoked",
          store: event.store,
          environment: event.environment
        },
        request.log
      );
      await updateWebhookEventOutcome(event.eventId, changed ? "applied" : "duplicate_transaction");
      return reply.send({ ok: true, duplicate: !changed, entitlement: room?.entitlement });
    } catch (err) {
      // Let RevenueCat's retry apply it.
      await forgetWebhookEvent(event.eventId).catch(() => undefined);
      throw err;
    }
  });

  /** Members only, not entitlement-gated: the paywall and the post-purchase poll read it. */
  app.get("/race-rooms/:roomId/billing", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (!room.memberships.some((member) => member.userId === request.identity?.sub)) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    return reply.send(billingViewOf(room));
  });

  /**
   * Admin comp for race directors (`npm run billing:comp`). Gated by a server secret
   * the apps never hold; never typed into an app (App Review 3.1.1).
   */
  app.post("/billing/admin/comp", async (request, reply) => {
    if (!secretMatches(process.env.BILLING_ADMIN_SECRET, request.headers[BILLING_ADMIN_SECRET_HEADER])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = compInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid comp payload" });
    }
    const room = await getRaceRoom(parsed.data.roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    const unlimited = parsed.data.unlimited === true;
    const { room: updated } = await applyBillingGrant(
      {
        transactionId: `comp:${room.id}:${unlimited ? "unlimited" : "one"}`,
        roomId: room.id,
        productId: unlimited ? "race_pass_full_crew" : "race_pass",
        appUserId: null,
        source: "admin_comp",
        status: "active"
      },
      request.log
    );
    if (!updated) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    return reply.send(billingViewOf(updated));
  });

  /**
   * Debug fake purchaser: the same grant path as the webhook, without a store.
   * Refused in production (see isManualBillingAllowed).
   */
  app.post("/race-rooms/:roomId/billing/dev-purchase", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (!isManualBillingAllowed()) {
      return reply.code(403).send({ error: "Fake purchases are disabled" });
    }
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (!room.memberships.some((member) => member.userId === request.identity?.sub)) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const parsed = devPurchaseInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid purchase payload" });
    }
    const { room: updated } = await applyBillingGrant(
      {
        transactionId: `dev:${randomUUID()}`,
        roomId: room.id,
        productId: parsed.data.productId,
        appUserId: request.identity.sub,
        source: "dev_fake",
        status: "active"
      },
      request.log
    );
    if (!updated) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    return reply.send(billingViewOf(updated));
  });
}
