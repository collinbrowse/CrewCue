/**
 * Billing (#649): crew tier cap, RevenueCat webhook, refunds, comp, and the
 * manual/dev paths that production refuses. Runs in memory and on Postgres (CI).
 */
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { evictRaceRoomFromMemoryForTests, setMembershipWriteDelayForTests } from "./raceRooms.js";
import { getBillingGrant, resetBillingStoreForTests } from "../lib/billingStore.js";
import { isRoomPersistenceEnabled } from "../lib/roomPersistence.js";

const WEBHOOK_AUTH = "rc-test-webhook-secret";
const ADMIN_SECRET = "billing-admin-test-secret";

type App = ReturnType<typeof buildApp>;

const savedEnv = { ...process.env };

beforeEach(async () => {
  process.env.REVENUECAT_WEBHOOK_AUTH = WEBHOOK_AUTH;
  process.env.BILLING_ADMIN_SECRET = ADMIN_SECRET;
  await resetBillingStoreForTests();
});

afterEach(() => {
  for (const key of ["REVENUECAT_WEBHOOK_AUTH", "BILLING_ADMIN_SECRET", "NODE_ENV", "BILLING_MANUAL_ENTITLEMENT"]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  setMembershipWriteDelayForTests(undefined);
});

function token(app: App, sub: string): string {
  return app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} });
}

async function createRunnerRoom(app: App, runner: string): Promise<{ id: string; joinCode: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: runner, name: "Billing Room", creatorRole: "athlete" },
    headers: { authorization: `Bearer ${token(app, runner)}` }
  });
  assert.equal(response.statusCode, 201);
  const room = response.json() as { id: string; joinCode: string; entitlement: { crewTier?: string } };
  assert.equal(room.entitlement.crewTier, "one");
  return room;
}

let eventSeq = 0;
function rcEvent(input: {
  type?: string;
  productId: string;
  transactionId: string;
  roomId?: string;
  eventId?: string;
  appUserId?: string;
}) {
  eventSeq += 1;
  return {
    api_version: "1.0",
    event: {
      id: input.eventId ?? `evt-${eventSeq}-${Date.now()}`,
      type: input.type ?? "NON_RENEWING_PURCHASE",
      app_user_id: input.appUserId ?? "runner",
      product_id: input.productId,
      transaction_id: input.transactionId,
      store: "APP_STORE",
      environment: "SANDBOX",
      purchased_at_ms: Date.now(),
      subscriber_attributes: input.roomId
        ? { crewcue_room_id: { value: input.roomId, updated_at_ms: Date.now() } }
        : {}
    }
  };
}

async function webhook(app: App, body: unknown, auth = WEBHOOK_AUTH) {
  return app.inject({ method: "POST", url: "/billing/revenuecat", payload: body as object, headers: { authorization: auth } });
}

async function joinByCode(app: App, code: string, user: string) {
  return app.inject({
    method: "POST",
    url: "/race-rooms/join-by-code",
    payload: { roomCode: code },
    headers: { authorization: `Bearer ${token(app, user)}` }
  });
}

async function billing(app: App, roomId: string, user: string) {
  const response = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/billing`,
    headers: { authorization: `Bearer ${token(app, user)}` }
  });
  assert.equal(response.statusCode, 200);
  return response.json() as {
    entitlement: { status: string; crewTier: string; source: string };
    crewCount: number;
    crewLimit?: number;
    offers: string[];
  };
}

async function getRoomStatus(app: App, roomId: string, user: string): Promise<number> {
  const response = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: { authorization: `Bearer ${token(app, user)}` }
  });
  return response.statusCode;
}

test("unpaid room is blocked, and its billing view offers the pass", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-unpaid");
  assert.equal(await getRoomStatus(app, room.id, "runner-unpaid"), 402);
  const view = await billing(app, room.id, "runner-unpaid");
  assert.equal(view.entitlement.status, "unpaid");
  assert.deepEqual(view.offers, ["race_pass", "race_pass_full_crew"]);
  assert.equal(view.crewLimit, 1);
  await app.close();
});

test("Race Pass: runner + 1 crew join, a third person gets the typed upgrade error", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-a");
  const paid = await webhook(app, rcEvent({ productId: "race_pass", transactionId: "tx-pass-a", roomId: room.id }));
  assert.equal(paid.statusCode, 200);

  assert.equal(await getRoomStatus(app, room.id, "runner-a"), 200);
  assert.equal((await joinByCode(app, room.joinCode, "crew-1")).statusCode, 200);
  assert.equal(await getRoomStatus(app, room.id, "crew-1"), 200);

  const third = await joinByCode(app, room.joinCode, "crew-2");
  assert.equal(third.statusCode, 409);
  assert.deepEqual(third.json(), {
    error: "Crew limit reached",
    code: "crew_limit_reached",
    roomId: room.id,
    crewLimit: 1,
    crewCount: 1,
    upgradeProductId: "crew_upgrade"
  });

  // Rejoining as an existing member is not a new seat.
  assert.equal((await joinByCode(app, room.joinCode, "crew-1")).statusCode, 200);
  // Inviting past the cap gets the same error for the runner's upgrade prompt.
  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/invites`,
    payload: { email: "crew2@example.com", role: "crew_member" },
    headers: { authorization: `Bearer ${token(app, "runner-a")}` }
  });
  assert.equal(invite.statusCode, 409);
  assert.equal((invite.json() as { code: string }).code, "crew_limit_reached");

  const view = await billing(app, room.id, "crew-1");
  assert.equal(view.entitlement.status, "paid");
  assert.equal(view.entitlement.crewTier, "one");
  assert.equal(view.entitlement.source, "provider_webhook");
  assert.deepEqual(view.offers, ["crew_upgrade"]);
  await app.close();
});

test("invite accept past the cap is refused even when the invite was issued under it", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-inv");
  await webhook(app, rcEvent({ productId: "race_pass", transactionId: "tx-pass-inv", roomId: room.id }));
  const runner = token(app, "runner-inv");
  const issue = async (email: string) => {
    const response = await app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/invites`,
      payload: { email, role: "crew_member" },
      headers: { authorization: `Bearer ${runner}` }
    });
    assert.equal(response.statusCode, 201);
    return (response.json() as { token: string }).token;
  };
  const first = await issue("a@example.com");
  const second = await issue("b@example.com");
  const accept = (inviteToken: string, user: string) =>
    app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/invites/accept`,
      payload: { token: inviteToken },
      headers: { authorization: `Bearer ${token(app, user)}` }
    });
  assert.equal((await accept(first, "crew-inv-a")).statusCode, 200);
  const refused = await accept(second, "crew-inv-b");
  assert.equal(refused.statusCode, 409);
  assert.equal((refused.json() as { code: string }).code, "crew_limit_reached");
  await app.close();
});

test("Full Crew upgrade unlocks unlimited crew for every member at once", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-up");
  await webhook(app, rcEvent({ productId: "race_pass", transactionId: "tx-pass-up", roomId: room.id }));
  assert.equal((await joinByCode(app, room.joinCode, "crew-up-1")).statusCode, 200);
  assert.equal((await joinByCode(app, room.joinCode, "crew-up-2")).statusCode, 409);

  const upgrade = await webhook(app, rcEvent({ productId: "crew_upgrade", transactionId: "tx-up", roomId: room.id }));
  assert.equal(upgrade.statusCode, 200);

  // The crew member's read sees the new tier with no action on their device.
  const crewView = await billing(app, room.id, "crew-up-1");
  assert.equal(crewView.entitlement.crewTier, "unlimited");
  assert.equal(crewView.crewLimit, undefined);
  assert.deepEqual(crewView.offers, []);
  assert.equal((await joinByCode(app, room.joinCode, "crew-up-2")).statusCode, 200);
  assert.equal((await joinByCode(app, room.joinCode, "crew-up-3")).statusCode, 200);
  await app.close();
});

test("combined product unlocks unlimited crew directly; an upgrade alone does not pay the room", async () => {
  const app = buildApp();
  await app.ready();
  const combined = await createRunnerRoom(app, "runner-combo");
  await webhook(app, rcEvent({ productId: "race_pass_full_crew", transactionId: "tx-combo", roomId: combined.id }));
  const view = await billing(app, combined.id, "runner-combo");
  assert.equal(view.entitlement.status, "paid");
  assert.equal(view.entitlement.crewTier, "unlimited");

  const upgradeOnly = await createRunnerRoom(app, "runner-upgrade-only");
  await webhook(app, rcEvent({ productId: "crew_upgrade", transactionId: "tx-up-only", roomId: upgradeOnly.id }));
  const pending = await billing(app, upgradeOnly.id, "runner-upgrade-only");
  assert.equal(pending.entitlement.status, "unpaid");
  await webhook(app, rcEvent({ productId: "race_pass", transactionId: "tx-pass-later", roomId: upgradeOnly.id }));
  const now = await billing(app, upgradeOnly.id, "runner-upgrade-only");
  assert.equal(now.entitlement.status, "paid");
  assert.equal(now.entitlement.crewTier, "unlimited");
  await app.close();
});

test("webhook rejects a bad or missing secret and says when it is not configured", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-secret");
  const body = rcEvent({ productId: "race_pass", transactionId: "tx-secret", roomId: room.id });
  assert.equal((await webhook(app, body, "wrong")).statusCode, 401);
  assert.equal(
    (await app.inject({ method: "POST", url: "/billing/revenuecat", payload: body })).statusCode,
    401
  );
  assert.equal((await billing(app, room.id, "runner-secret")).entitlement.status, "unpaid");

  delete process.env.REVENUECAT_WEBHOOK_AUTH;
  assert.equal((await webhook(app, body)).statusCode, 503);
  await app.close();
});

test("duplicate webhook delivery is acknowledged once and applied once", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-dup");
  const body = rcEvent({ productId: "race_pass", transactionId: "tx-dup", roomId: room.id, eventId: "evt-dup" });
  const first = await webhook(app, body);
  assert.equal(first.statusCode, 200);
  assert.equal((first.json() as { duplicate: boolean }).duplicate, false);

  const again = await webhook(app, body);
  assert.equal(again.statusCode, 200);
  assert.equal((again.json() as { duplicate: boolean }).duplicate, true);

  // Same transaction under a new event id (RevenueCat resend) is also a no-op.
  const resent = await webhook(app, rcEvent({ productId: "race_pass", transactionId: "tx-dup", roomId: room.id }));
  assert.equal(resent.statusCode, 200);
  assert.equal((resent.json() as { duplicate: boolean }).duplicate, true);

  assert.equal((await billing(app, room.id, "runner-dup")).entitlement.status, "paid");
  await app.close();
});

test("webhook for an unknown room is stored, logged, and does not crash", async () => {
  const app = buildApp();
  await app.ready();
  const unknown = await webhook(
    app,
    rcEvent({ productId: "race_pass", transactionId: "tx-unknown", roomId: "00000000-0000-4000-8000-000000000000" })
  );
  assert.equal(unknown.statusCode, 200);
  assert.equal((unknown.json() as { unknownRoom: boolean }).unknownRoom, true);
  const stored = await getBillingGrant("tx-unknown");
  assert.equal(stored?.roomId, null);
  assert.equal(stored?.productId, "race_pass");

  const noAttribute = await webhook(app, rcEvent({ productId: "race_pass", transactionId: "tx-no-room" }));
  assert.equal(noAttribute.statusCode, 200);
  assert.equal((noAttribute.json() as { unknownRoom: boolean }).unknownRoom, true);

  const ignored = await webhook(app, { event: { id: "evt-test", type: "TEST" } });
  assert.equal(ignored.statusCode, 200);
  assert.equal((await webhook(app, { nope: true })).statusCode, 400);

  // The API still serves rooms afterwards.
  const room = await createRunnerRoom(app, "runner-after-unknown");
  assert.equal((await billing(app, room.id, "runner-after-unknown")).entitlement.status, "unpaid");
  await app.close();
});

test("refund drops the tier: existing crew stay, new joins are refused", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-refund");
  await webhook(app, rcEvent({ productId: "race_pass", transactionId: "tx-r-pass", roomId: room.id }));
  await webhook(app, rcEvent({ productId: "crew_upgrade", transactionId: "tx-r-up", roomId: room.id }));
  for (const crew of ["crew-r-1", "crew-r-2", "crew-r-3"]) {
    assert.equal((await joinByCode(app, room.joinCode, crew)).statusCode, 200);
  }

  const refund = await webhook(
    app,
    rcEvent({ type: "CANCELLATION", productId: "crew_upgrade", transactionId: "tx-r-up", roomId: room.id })
  );
  assert.equal(refund.statusCode, 200);
  const view = await billing(app, room.id, "crew-r-2");
  assert.equal(view.entitlement.status, "paid");
  assert.equal(view.entitlement.crewTier, "one");
  assert.equal(view.crewCount, 3);
  assert.equal(await getRoomStatus(app, room.id, "crew-r-3"), 200);
  const refused = await joinByCode(app, room.joinCode, "crew-r-4");
  assert.equal(refused.statusCode, 409);
  assert.equal((refused.json() as { crewCount: number }).crewCount, 3);

  // Refund reversed restores the upgrade.
  await webhook(app, rcEvent({ type: "REFUND_REVERSED", productId: "crew_upgrade", transactionId: "tx-r-up", roomId: room.id }));
  assert.equal((await billing(app, room.id, "runner-refund")).entitlement.crewTier, "unlimited");

  // Refunding the pass itself locks the room again; nobody is removed.
  await webhook(app, rcEvent({ type: "CANCELLATION", productId: "race_pass", transactionId: "tx-r-pass", roomId: room.id }));
  const locked = await billing(app, room.id, "runner-refund");
  assert.equal(locked.entitlement.status, "unpaid");
  assert.equal(locked.crewCount, 3);
  assert.equal(await getRoomStatus(app, room.id, "runner-refund"), 402);
  await app.close();
});

test("two crew joining at the same moment take one seat between them (room lock)", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-race");
  await webhook(app, rcEvent({ productId: "race_pass", transactionId: "tx-race", roomId: room.id }));

  // Hold the first join between its read and its save, so the second lands in that gap.
  setMembershipWriteDelayForTests(() => new Promise((resolve) => setTimeout(resolve, 50)));
  const results = await Promise.all([
    joinByCode(app, room.joinCode, "crew-race-a"),
    joinByCode(app, room.joinCode, "crew-race-b")
  ]);
  const codes = results.map((r) => r.statusCode).sort();
  assert.deepEqual(codes, [200, 409]);
  assert.equal((await billing(app, room.id, "runner-race")).crewCount, 1);
  await app.close();
});

test("admin comp marks a room paid without a purchase and needs the server secret", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-comp");
  const comp = (secret: string, unlimited?: boolean) =>
    app.inject({
      method: "POST",
      url: "/billing/admin/comp",
      payload: { roomId: room.id, ...(unlimited ? { unlimited } : {}) },
      headers: { "x-crewcue-billing-admin-secret": secret }
    });
  assert.equal((await comp("wrong")).statusCode, 401);
  // A member's own JWT is not enough.
  const asMember = await app.inject({
    method: "POST",
    url: "/billing/admin/comp",
    payload: { roomId: room.id },
    headers: { authorization: `Bearer ${token(app, "runner-comp")}` }
  });
  assert.equal(asMember.statusCode, 401);

  const one = await comp(ADMIN_SECRET);
  assert.equal(one.statusCode, 200);
  assert.equal((one.json() as { entitlement: { status: string; source: string } }).entitlement.status, "paid");
  assert.equal((one.json() as { entitlement: { source: string } }).entitlement.source, "admin_comp");
  assert.equal(await getRoomStatus(app, room.id, "runner-comp"), 200);

  const unlimited = await comp(ADMIN_SECRET, true);
  assert.equal((unlimited.json() as { entitlement: { crewTier: string } }).entitlement.crewTier, "unlimited");
  // Running it again changes nothing.
  assert.equal((await comp(ADMIN_SECRET, true)).statusCode, 200);

  const missing = await app.inject({
    method: "POST",
    url: "/billing/admin/comp",
    payload: { roomId: "no-such-room" },
    headers: { "x-crewcue-billing-admin-secret": ADMIN_SECRET }
  });
  assert.equal(missing.statusCode, 404);
  delete process.env.BILLING_ADMIN_SECRET;
  assert.equal((await comp(ADMIN_SECRET)).statusCode, 401);
  await app.close();
});

test("production refuses the manual entitlement and the fake purchaser unless staging opts in", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-prod");
  const runner = token(app, "runner-prod");
  const manual = () =>
    app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/entitlement`,
      payload: { status: "paid" },
      headers: { authorization: `Bearer ${runner}` }
    });
  const fake = (productId: string) =>
    app.inject({
      method: "POST",
      url: `/race-rooms/${room.id}/billing/dev-purchase`,
      payload: { productId },
      headers: { authorization: `Bearer ${runner}` }
    });

  process.env.NODE_ENV = "production";
  assert.equal((await manual()).statusCode, 403);
  assert.equal((await fake("race_pass")).statusCode, 403);
  assert.equal((await billing(app, room.id, "runner-prod")).entitlement.status, "unpaid");

  process.env.BILLING_MANUAL_ENTITLEMENT = "enabled";
  const devPass = await fake("race_pass");
  assert.equal(devPass.statusCode, 200);
  assert.equal((devPass.json() as { entitlement: { crewTier: string } }).entitlement.crewTier, "one");
  const devUpgrade = await fake("crew_upgrade");
  assert.equal((devUpgrade.json() as { entitlement: { crewTier: string } }).entitlement.crewTier, "unlimited");
  assert.equal((await fake("season_pass")).statusCode, 400);
  await app.close();
});

test("non-members cannot read a room's billing", async () => {
  const app = buildApp();
  await app.ready();
  const room = await createRunnerRoom(app, "runner-private");
  const response = await app.inject({
    method: "GET",
    url: `/race-rooms/${room.id}/billing`,
    headers: { authorization: `Bearer ${token(app, "stranger")}` }
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test("paid entitlement and webhook idempotency survive an API restart (Postgres)", { skip: !isRoomPersistenceEnabled() }, async () => {
  const first = buildApp();
  await first.ready();
  const room = await createRunnerRoom(first, "runner-restart");
  const body = rcEvent({ productId: "race_pass", transactionId: "tx-restart", roomId: room.id, eventId: "evt-restart" });
  assert.equal((await webhook(first, body)).statusCode, 200);
  await first.close();

  // A fresh process has no cached room; everything comes back from Postgres.
  evictRaceRoomFromMemoryForTests(room.id);
  const second = buildApp();
  await second.ready();
  const view = await billing(second, room.id, "runner-restart");
  assert.equal(view.entitlement.status, "paid");
  assert.equal(view.entitlement.crewTier, "one");
  const redelivered = await webhook(second, body);
  assert.equal((redelivered.json() as { duplicate: boolean }).duplicate, true);
  assert.equal((await getBillingGrant("tx-restart"))?.status, "active");
  await second.close();
});
