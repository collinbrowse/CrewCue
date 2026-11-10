/**
 * Room billing rules (#649). Pure: no storage, no Fastify.
 *
 * A Race Pass unlocks a room for the runner plus one crew member. The Full Crew
 * upgrade (or the combined product) lifts the crew cap. Crew never pay.
 */
import type {
  BillingProductId,
  CrewLimitReachedError,
  RaceRoom,
  RaceRoomBilling,
  RaceRoomCrewTier,
  RaceRoomEntitlement
} from "@crewcue/contracts";

export const BILLING_PRODUCT_IDS: readonly BillingProductId[] = ["race_pass", "crew_upgrade", "race_pass_full_crew"];

/** Crew allowed besides the runner on a room that is not on the unlimited tier. */
export const BASE_CREW_LIMIT = 1;

export function isBillingProductId(value: unknown): value is BillingProductId {
  return typeof value === "string" && (BILLING_PRODUCT_IDS as readonly string[]).includes(value);
}

/**
 * Rooms stored before billing have no tier. They were paid by hand during beta,
 * so they keep unlimited crew. New rooms are created with `one`.
 */
export function crewTierOf(entitlement: RaceRoomEntitlement): RaceRoomCrewTier {
  return entitlement.crewTier ?? "unlimited";
}

/** Crew allowed besides the runner, or undefined when unlimited. Unpaid rooms use the base cap too. */
export function crewLimitOf(room: RaceRoom): number | undefined {
  return crewTierOf(room.entitlement) === "unlimited" ? undefined : BASE_CREW_LIMIT;
}

/**
 * The runner seat: the race athlete, and the room's creator (the purchaser, who is the
 * athlete in the apps; a crew chief creating a room for a runner does not use up the crew seat).
 * Every other member counts against the crew cap.
 */
export function isCrewMembership(room: RaceRoom, member: { userId: string; role: string }): boolean {
  if (member.role === "athlete" || member.userId === room.athleteId) return false;
  const creator = room.createdByUserId ?? room.memberships[0]?.userId;
  return member.userId !== creator;
}

export function crewCountOf(room: RaceRoom): number {
  return room.memberships.filter((member) => isCrewMembership(room, member)).length;
}

/**
 * Whether one more crew member fits. Existing members always stay (a refund or a
 * lowered tier never removes anyone); only new crew are refused.
 */
export function crewLimitError(room: RaceRoom, additionalCrew = 1): CrewLimitReachedError | undefined {
  const limit = crewLimitOf(room);
  if (limit === undefined) return undefined;
  const count = crewCountOf(room);
  if (count + additionalCrew <= limit) return undefined;
  return {
    error: "Crew limit reached",
    code: "crew_limit_reached",
    roomId: room.id,
    crewLimit: limit,
    crewCount: count,
    upgradeProductId: "crew_upgrade"
  };
}

/** Products that would change this room's entitlement, cheapest path first. */
export function offersFor(room: RaceRoom): BillingProductId[] {
  if (room.entitlement.status !== "paid") {
    return ["race_pass", "race_pass_full_crew"];
  }
  return crewTierOf(room.entitlement) === "unlimited" ? [] : ["crew_upgrade"];
}

export function billingViewOf(room: RaceRoom): RaceRoomBilling {
  const limit = crewLimitOf(room);
  return {
    roomId: room.id,
    entitlement: { ...room.entitlement, crewTier: crewTierOf(room.entitlement) },
    crewCount: crewCountOf(room),
    ...(limit !== undefined ? { crewLimit: limit } : {}),
    offers: offersFor(room)
  };
}

export type BillingGrantSource = "revenuecat" | "admin_comp" | "dev_fake";

/** One purchase (or comp) recorded against a room. Revoked grants stay for the audit trail. */
export type BillingGrant = {
  transactionId: string;
  roomId: string | null;
  productId: string;
  appUserId: string | null;
  source: BillingGrantSource;
  status: "active" | "revoked";
  store?: string;
  environment?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Entitlement implied by a room's grants, or undefined when the room has none
 * (rooms paid by hand before billing keep their entitlement untouched).
 *
 * A pass (alone or combined) makes the room paid. A Full Crew upgrade only counts
 * with a pass, so an upgrade bought for an unpaid room waits for the pass.
 */
export function entitlementFromGrants(
  grants: readonly BillingGrant[],
  now: string
): RaceRoomEntitlement | undefined {
  if (grants.length === 0) return undefined;
  const active = grants.filter((grant) => grant.status === "active");
  const hasPass = active.some((grant) => grant.productId === "race_pass" || grant.productId === "race_pass_full_crew");
  const hasFullCrew = active.some(
    (grant) => grant.productId === "crew_upgrade" || grant.productId === "race_pass_full_crew"
  );
  const latest = [...grants].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const source: RaceRoomEntitlement["source"] =
    latest?.source === "admin_comp" ? "admin_comp" : latest?.source === "dev_fake" ? "manual" : "provider_webhook";
  return {
    status: hasPass ? "paid" : "unpaid",
    crewTier: hasPass && hasFullCrew ? "unlimited" : "one",
    lastUpdatedAt: now,
    source
  };
}

/** The RevenueCat subscriber attribute the apps set to the room id before a purchase. */
export const REVENUECAT_ROOM_ATTRIBUTE = "crewcue_room_id";

export type RevenueCatAction = "grant" | "revoke" | "ignore";

export type ParsedRevenueCatEvent = {
  eventId: string;
  type: string;
  action: RevenueCatAction;
  transactionId?: string;
  productId?: string;
  appUserId?: string;
  roomId?: string;
  store?: string;
  environment?: string;
};

/**
 * Consumables arrive as NON_RENEWING_PURCHASE. A refund of a one-time purchase
 * arrives as CANCELLATION; REFUND_REVERSED restores it. Everything else is acknowledged and ignored.
 */
export function parseRevenueCatEvent(body: unknown): ParsedRevenueCatEvent | undefined {
  if (!body || typeof body !== "object") return undefined;
  const event = (body as { event?: unknown }).event;
  if (!event || typeof event !== "object") return undefined;
  const e = event as Record<string, unknown>;
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  const eventId = text(e.id);
  const type = text(e.type);
  if (!eventId || !type) return undefined;

  const attributes = e.subscriber_attributes as Record<string, { value?: unknown }> | undefined;
  const roomId = text(attributes?.[REVENUECAT_ROOM_ATTRIBUTE]?.value);
  const productId = text(e.product_id);

  let action: RevenueCatAction = "ignore";
  if (isBillingProductId(productId)) {
    if (type === "NON_RENEWING_PURCHASE" || type === "INITIAL_PURCHASE" || type === "REFUND_REVERSED") {
      action = "grant";
    } else if (type === "CANCELLATION" || type === "EXPIRATION") {
      action = "revoke";
    }
  }

  return {
    eventId,
    type,
    action,
    transactionId: text(e.transaction_id) ?? text(e.original_transaction_id),
    productId,
    appUserId: text(e.app_user_id) ?? text(e.original_app_user_id),
    roomId,
    store: text(e.store),
    environment: text(e.environment)
  };
}
