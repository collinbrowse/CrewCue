# Billing API (#649)

Runners pay per race through Apple or Google in-app purchase, handled by RevenueCat. Crew never pay. Pricing and store rules: `docs/product/pricing-and-v1-scope.md`. Store and RevenueCat setup: `docs/runbooks/mobile-release.md` (Billing).

| Product id (consumable) | Effect on the room |
| --- | --- |
| `race_pass` | `paid`, crew tier `one` (runner + 1 crew) |
| `crew_upgrade` | crew tier `unlimited`, once the room also has a pass |
| `race_pass_full_crew` | `paid`, crew tier `unlimited` |

A room's entitlement is recomputed from all of its grants (purchases and comps) under the room lock. Grants live in Postgres (`billing_grants`, migration `0019_billing_grants.sql`); each webhook delivery is recorded by event id (`billing_webhook_events`).

## `POST /billing/revenuecat`

RevenueCat webhook. No JWT. The `Authorization` header must equal `REVENUECAT_WEBHOOK_AUTH` (the value configured in RevenueCat). The apps set the subscriber attribute `crewcue_room_id` to the room before buying; the event's `subscriber_attributes.crewcue_room_id.value` attaches the purchase.

| Event `type` | Action |
| --- | --- |
| `NON_RENEWING_PURCHASE`, `INITIAL_PURCHASE`, `REFUND_REVERSED` | grant the transaction |
| `CANCELLATION`, `EXPIRATION` (refund or revocation) | revoke the transaction: the tier drops, existing members stay, new crew are refused |
| anything else (`TEST`, `TRANSFER`, …) or another product | acknowledged, ignored |

| Code | Meaning |
| --- | --- |
| 200 `{ok, duplicate, entitlement}` | Applied. `duplicate: true` for a redelivered event id or an already-recorded transaction (nothing changes). |
| 200 `{ok, unknownRoom: true}` | No room attribute, or no such room. The grant is stored with `room_id` null and logged (`billing_webhook_unknown_room`); support can attach it. |
| 400 | Not a RevenueCat event body |
| 401 | Missing or wrong `Authorization` |
| 503 | `REVENUECAT_WEBHOOK_AUTH` is not set |

If applying a grant fails, the delivery record is removed so RevenueCat's retry applies it.

## `GET /race-rooms/:roomId/billing`

Members only, **not** entitlement-gated, so an unpaid room can show its paywall and the apps can poll after a purchase (the webhook may land after the store says "purchased"). Returns `RaceRoomBilling`: `entitlement` (with `crewTier`), `crewCount`, `crewLimit` (absent when unlimited), `offers` (products that would change the room).

## `POST /billing/admin/comp`

Admin only: header `x-crewcue-billing-admin-secret` must equal `BILLING_ADMIN_SECRET`. Body `{ roomId, unlimited? }`. Marks the room paid with no purchase (source `admin_comp`); idempotent per room and tier. Use the script, never an app:

```bash
CREWCUE_API_URL=https://<api-host> BILLING_ADMIN_SECRET=... npm run billing:comp -- <roomId> [--unlimited]
```

## `POST /race-rooms/:roomId/billing/dev-purchase`

Debug builds' fake purchaser. Member JWT, body `{ productId }`. Records a `dev_fake` grant through the same path as the webhook. With `NODE_ENV=production` it answers 403 unless `BILLING_MANUAL_ENTITLEMENT=enabled` (staging).
