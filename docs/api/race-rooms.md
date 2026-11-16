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
| `unpaid` | **402** `{ "error": "Entitlement unpaid" }` (the runner's teaser reads below excepted) |
| `paid` | allowed (subject to role permissions for activate) |
| `expired` | **403** `{ "error": "Entitlement expired" }` |

Entitlement updates themselves do **not** require a paid entitlement; they only require membership and sufficient role.

### Unpaid race: the runner's teaser

The runner (`room.athleteId`) sets up an unpaid race before paying. An unpaid race shows its runner **the course and the finish ETA only**: no aid station or other mid-course checkpoint ETA anywhere, whatever the course's tags, order or checkpoints. Only these routes let the runner through, and the reads are shaped on the server ([raceTeaser.ts](../../services/api/src/lib/raceTeaser.ts)):

| Route | Unpaid, runner |
| --- | --- |
| `GET /race-rooms/:roomId` | 200. `course.baselineTrack` is dropped; `pacingEstimate.aidEtas` is empty (`expectedFinishAt`, `expectedFinishElapsedSeconds` and `bands` stay). Geometry and checkpoints stay. |
| `PUT /race-rooms/:roomId/course` | allowed; the response is the room teaser. An idempotent replay answers from the room as it is now, shaped for the caller, never the stored body (a key first used while paid replays the teaser after a refund). |
| `PUT /race-rooms/:roomId/pacing-estimate` | allowed with `pacingEstimateId` of an estimate the server computed; `estimate.aidEtas` in the response is empty. An inline `estimate` body is **402** `room_unpaid`. |
| `POST /pacing-estimates` with `roomId` | allowed; the response is finish-only (`aidEtas` empty; finish fields and bands stay). The stored estimate is whole, so paying unlocks every ETA without a recompute. Crew get 402. |
| `GET /race-rooms/:roomId/projection` | 200. `checkpointSplits` and `remainingCheckpointEtas` are empty; `etaFinishPlanIso`, `etaFinishWindow` and course-level fields stay. Before the runner's first accepted ping, `etaFinishPlanIso` is the finish from the start line (the plan curve to the course length plus every planned stop, never earlier than the projection), so listing a mid-course stop first cannot turn it into the finish from that stop; that pre-race read carries no `etaFinishWindow`. |
| `GET /race-rooms/:roomId/schedule` | 200. `stops` keeps the start and the finish only. The sheet is built from the finish-only plan without the plan curve, so a course re-saved to start or end at a priced stop never carries that stop's ETA. |

Teaser projection and schedule responses carry `locked: { checkpointIds }`: every checkpoint between the start and the finish, in course order. Paid responses never do. Every other member, and every other gated route, still gets 402. An expired race stays 403 for everyone.

Crew-facing actions need a paid race for everyone, the runner included: crew chat (messages, photos, diagnostics), every invite (any role, `athlete` included), and any invite accept or code join by someone who does not hold the runner seat (the race athlete or the room creator) answer **402** `{ "error": "Race not unlocked", "code": "room_unpaid" }`. The runner's own seat is not refused this way.

Every other route that answers a member of an unpaid race with a room (`POST /race-rooms` and its idempotent retry or reclaim, which answers from the room as it is now and gives another account reusing the key 409, `GET /race-rooms/mine`, `GET /teams/:teamId/race-rooms`, join-by-code for an existing member, invite accept, `PATCH`/`DELETE .../members/...`) shapes it with `roomForViewer`: the runner gets the room teaser above; anyone else gets the room without `pacingEstimate`, `pacingEstimateId` or `course.baselineTrack` (name, code, roster, entitlement and course stay, so lists and the paywall render). The anonymous `GET /race-rooms/join-preview/:roomCode` omits `baselineTrack` on an unpaid race.

**Where an estimate went.** A stored estimate records a room (`roomId`): the race `POST /pacing-estimates` computed it for, replaced by each race it is attached to. Attaching an estimate whose recorded race is another race that is currently unpaid is **402** `room_unpaid` (by id, or an inline snapshot that reuses its id), so a paid race cannot unlock an unpaid race's plan. Once that race is paid, the estimate attaches anywhere.

`GET /me/export` returns a stored estimate whole only when it is tied to a paid race the caller belongs to: its recorded race is paid, or it is the plan of record of a paid race of theirs. Everything else exports finish-only: an unpaid race's estimates, an expired race's, and room-less ones. A room-less estimate later attached to a paid race exports whole.

`POST /pacing-estimates` without `roomId` (checkpoints and `raceStartAt` in the body) prices whatever checkpoints are posted, including a course copied from an unpaid race, so it always answers finish-only, for everyone, paid races included. No shipped client calls it without `roomId`.

Both `POST /pacing-estimates` and `PUT /race-rooms/:roomId/pacing-estimate` are limited to 20 requests an hour per user (all races together; **429** with `retry-after` past that).

### Crew tier (#649)

`room.entitlement.crewTier` is `one` (Race Pass: the runner plus 1 crew member) or `unlimited` (Full Crew). New rooms start `unpaid` with `one`. Rooms stored before billing have no tier and read as `unlimited`. The runner seat (the race athlete and the room creator, `createdByUserId`) does not count; every other member is crew.

On an unpaid race these are refused first with **402** `room_unpaid` (above), not as a full cap. Joining by code, accepting an invite, or issuing a non-athlete invite past the cap returns **409** with a `CrewLimitReachedError` body (`code: "crew_limit_reached"`, `crewLimit`, `crewCount`, `upgradeProductId: "crew_upgrade"`). The check runs under the room lock, so two joins at once cannot both take the last seat. A lowered tier never removes members. Purchases and the billing view are in [billing.md](billing.md).

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
| 200 | Success (on an unpaid race, the runner's teaser) |
| 401 | Missing/invalid JWT or malformed claims |
| 403 | Caller not a member, or entitlement `expired` |
| 402 | Entitlement `unpaid` (anyone but the runner) |
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
| 402 | `room_unpaid`: the race is unpaid (any role) |
| 403 | Not a member, insufficient role, or a non-owner issuer requested a role other than `crew_member` |
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
| 200 | Returns `{ room, assignedRole, permissions }` (`room` shaped by `roomForViewer` on an unpaid race) |
| 400 | Invalid payload |
| 401 | Missing/invalid JWT or malformed claims |
| 402 | `room_unpaid`: the race is unpaid and the caller does not hold the runner seat |
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
