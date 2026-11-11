# Race rooms API (staging contract)

This document describes the **current** HTTP surface for race rooms, invites, and entitlement updates implemented in `services/api/src/routes/raceRooms.ts`. Payloads and responses align with `@crewcue/contracts` types where noted.

## Authentication

All routes except `/health` run the auth pre-handler (`services/api/src/plugins/auth.ts`):

- Requests may include `Authorization: Bearer <jwt>`.
- If verification fails, or the JWT payload does not match the expected claims shape, `request.identity` is unset and protected handlers respond with **401 Unauthorized** (`{ "error": "Unauthorized" }`).
- Expected JWT claims (validated with Zod after verify):

| Field | Type | Required |
| --- | --- | --- |
| `sub` | string | yes |
| `email` | string (email) | no |
| `teamIds` | string[] | yes (may be empty) |
| `roomRoles` | record string → string | yes (may be empty) |

## Role model and permissions

Room membership carries a `role` from `@crewcue/contracts` (`athlete`, `crew_member`, `crew_chief`, `team_manager`).

Effective permissions for a member:

| Action | Who may perform |
| --- | --- |
| View room (`GET`) | Any member |
| Activate room (`POST .../activate`) | `athlete`, `crew_chief`, `team_manager` |
| Issue invite (`POST .../invites`) | `athlete`, `crew_chief`, `team_manager` |
| Update entitlement (`POST .../entitlement`) | `athlete`, `crew_chief`, `team_manager` |

Non-members receive **403 Forbidden** for those operations (except invite acceptance; see below).

## Entitlement gating

`room.entitlement.status` drives read/activate access after membership checks:

| Status | `GET /race-rooms/:roomId` / `POST .../activate` |
| --- | --- |
| `unpaid` | **402** `{ "error": "Entitlement unpaid" }` |
| `paid` | allowed (subject to role permissions for activate) |
| `expired` | **403** `{ "error": "Entitlement expired" }` |

Entitlement updates themselves do **not** require a paid entitlement; they only require membership and sufficient role.

### Crew tier (#649)

`room.entitlement.crewTier` is `one` (Race Pass: the runner plus 1 crew member) or `unlimited` (Full Crew). New rooms start `unpaid` with `one`. Rooms stored before billing have no tier and read as `unlimited`. The runner seat (the race athlete and the room creator, `createdByUserId`) does not count; every other member is crew.

Joining by code, accepting an invite, or issuing a non-athlete invite past the cap returns **409** with a `CrewLimitReachedError` body (`code: "crew_limit_reached"`, `crewLimit`, `crewCount`, `upgradeProductId: "crew_upgrade"`). The check runs under the room lock, so two joins at once cannot both take the last seat. A lowered tier never removes members. Purchases and the billing view are in [billing.md](billing.md).

## Endpoints

### `POST /race-rooms`

Creates a draft room; creator becomes the first member with `creatorRole`.

**Body (JSON)**

| Field | Type | Notes |
| --- | --- | --- |
| `teamId` | string | required |
| `athleteId` | string | required |
| `name` | string | required |
| `creatorRole` | role enum | optional, default `athlete` |

**Responses**

| Code | Meaning |
| --- | --- |
| 201 | Returns the full `RaceRoom` resource |
| 400 | Invalid payload |
| 401 | Missing/invalid JWT or malformed claims |

### `GET /race-rooms/:roomId`

Returns `{ room, permissions }` for the caller’s membership role.

**Responses**

| Code | Meaning |
| --- | --- |
| 200 | Success |
| 401 | Missing/invalid JWT or malformed claims |
| 403 | Caller not a member, or entitlement `expired` |
| 402 | Entitlement `unpaid` |
| 404 | Unknown `roomId` |

### `POST /race-rooms/:roomId/activate`

Activates the room (`status: "active"`) and sets `eventEndsAt`.

**Body (JSON)**

| Field | Type | Notes |
| --- | --- | --- |
| `eventEndsAt` | ISO datetime string | required |

**Responses**

| Code | Meaning |
| --- | --- |
| 200 | Returns updated `RaceRoom` |
| 400 | Invalid payload |
| 401 | Missing/invalid JWT or malformed claims |
| 403 | Not a member, insufficient role, or entitlement expired |
| 402 | Entitlement unpaid |
| 404 | Unknown `roomId` |

### `POST /race-rooms/:roomId/invites`

Issues a pending invite for an email and target role.

**Body (JSON)**

| Field | Type | Notes |
| --- | --- | --- |
| `email` | string (email) | required |
| `role` | role enum | required |
| `expiresAt` | ISO datetime string | optional; default ~24h from issue |

**Responses**

| Code | Meaning |
| --- | --- |
| 201 | Returns invite metadata (`token`, `roomId`, `email`, `role`, `expiresAt`) |
| 400 | Invalid payload |
| 401 | Missing/invalid JWT or malformed claims |
| 403 | Not a member or insufficient role |
| 404 | Unknown `roomId` |

### `POST /race-rooms/:roomId/invites/accept`

Accepts an invite token for the authenticated user (membership is created or role updated).

**Body (JSON)**

| Field | Type | Notes |
| --- | --- | --- |
| `token` | string | required |

**Responses**

| Code | Meaning |
| --- | --- |
| 200 | Returns `{ room, assignedRole, permissions }` |
| 400 | Invalid payload |
| 401 | Missing/invalid JWT or malformed claims |
| 404 | Room not found, or invite not found for this room/token |
| 409 | Invite not pending |
| 410 | Invite expired (status updated to `expired`) |

### `POST /race-rooms/:roomId/entitlement`

Updates `room.entitlement` (manual source, server timestamp). For local dev, tests, and staging only: with `NODE_ENV=production` it answers **403** `Manual entitlement is disabled` unless `BILLING_MANUAL_ENTITLEMENT=enabled`. Production rooms are paid by store purchases ([billing.md](billing.md)).

**Body (JSON)**

| Field | Type | Notes |
| --- | --- | --- |
| `status` | `"unpaid"` \| `"paid"` \| `"expired"` | required |
| `crewTier` | `"one"` \| `"unlimited"` | optional, default `unlimited` |

**Responses**

| Code | Meaning |
| --- | --- |
| 200 | Returns updated entitlement object |
| 400 | Invalid payload |
| 401 | Missing/invalid JWT or malformed claims |
| 403 | Not a member or insufficient role |
| 404 | Unknown `roomId` |

### `PATCH /race-rooms/:roomId/checkpoint-stops`

Sets the planned stop (aid dwell) for one or more checkpoints (#250, Pace edit). Each row is the new absolute value, so a retried request is idempotent. All rows apply or none. The stored projection is recomputed, so `/schedule` arrivals after a changed checkpoint move by the change.

Unlike `PUT /race-rooms/:roomId/course`, this does **not** reset course-dependent crew state (task board, adaptive plan, sync). A planned stop changes timing, not the course. This is not the deferred stop-plan overlay API (`/stop-plans`, `delayOverrideSeconds`).

**Body (JSON)**

| Field | Type | Notes |
| --- | --- | --- |
| `stops` | array, 1–500 | each checkpoint at most once |
| `stops[].checkpointId` | string | must exist on the room's course |
| `stops[].plannedStopSeconds` | integer | 0–21600 (6 h) |

**Responses**

| Code | Meaning |
| --- | --- |
| 200 | Returns the updated race room |
| 400 | Invalid payload |
| 401 | Missing/invalid JWT or malformed claims |
| 403 | Not a member, not a course editor (athlete, crew chief, team manager), or entitlement |
| 404 | Unknown room, no course, or unknown checkpoint ids (`checkpointIds` lists them; nothing is saved) |

## Notes for consumers

- In-memory stores reset on process restart; treat this as a **contract + behavior sketch** until persistence lands in a later slice.
- Distinct **402** vs **403** errors are intentional for billing UX vs hard entitlement expiry.
