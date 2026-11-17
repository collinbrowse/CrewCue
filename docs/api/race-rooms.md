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
| Edit the course or the start (`PUT .../course`, `PATCH .../race-start`) | `athlete`, `crew_chief`, `team_manager` |

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
| `PUT /race-rooms/:roomId/course` | allowed, up to 10 saves an hour per user across all their unpaid races, start changes included (**429** `{ "error": "Too many requests" }` with `retry-after` past that; paid course saves are not limited). Only a save that writes counts: a rejected payload or course (400) and an idempotent replay do not, and a replay of a save that committed is answered past the limit too. The response is the room teaser. An idempotent replay answers from the room as it is now, shaped for the caller, never the stored body (a key first used while paid replays the teaser after a refund). |
| `PATCH /race-rooms/:roomId/race-start` | allowed, as `PUT .../course`: each change that writes counts toward the same 10 an hour, and the response (and an idempotent replay) is the room teaser. See [the route](#patch-race-roomsroomidrace-start). |
| `PUT /race-rooms/:roomId/pacing-estimate` | allowed with `pacingEstimateId` of an estimate the server computed for this course: its recorded course length must be within 1% or 100 m (whichever is larger) of the race's current course length, else **400** `{ "error": …, "code": "course_mismatch" }` (compute a new one for the course). The race's course length is its stored length (`course.derivedMetrics.canonicalDistanceMeters`, else `courseDistanceMeters`), else, on a legacy room with neither, the length of its route; never a checkpoint's distance. A race with no stored length and no route has no length, so nothing fits it. This holds for a re-attach of the plan already attached too; that plan then stays attached. Where the checkpoints end does not matter here. `estimate.aidEtas` in the response is empty. An inline `estimate` body is **402** `room_unpaid`. Paid races take any length. |
| `POST /pacing-estimates` with `roomId` | allowed; the response is finish-only (`aidEtas` empty; finish fields and bands stay). The stored estimate is whole, so paying unlocks every ETA without a recompute. The model simulates the whole route and reads the finish (expected and bands) at the course length (the same length as the attach check above, the route's on a legacy room), paid races included, so checkpoints that stop short of the route's end (a GPX with no finish waypoint, a finish dropped, a priced stop last) still get the finish at the end of the route, never the last stop's ETA. A request without `roomId` still reads it at the farthest checkpoint. The estimate records that length. A paid race's schedule puts that finish on its farthest checkpoint only when the checkpoint is at the course's end (within 1% of the course length or 100 m, whichever is larger); a last aid station short of it keeps the plan's own ETA there, and the finish is the projection's (`etaFinishPlanIso`, every planned stop on the way counted). Crew get 402. |
| `GET /race-rooms/:roomId/projection` | 200. `checkpointSplits` and `remainingCheckpointEtas` are empty; course-level fields stay. `etaFinishPlanIso` is always the finish from the start line (the plan curve to the course length plus every planned stop before the finish, never the finish checkpoint's own, and never earlier than the projection; without a plan curve, planned pace from the start, or from when the projection was taken once the race has begun), and there is no `etaFinishWindow`, before or after any accepted ping: the projection measures its own finish from where it places the runner (the first listed checkpoint, or the last ping), which the runner chooses, and the finish from a mid-course point is the finish minus that point's ETA. |
| `GET /race-rooms/:roomId/schedule` | 200. `stops` keeps the start and the finish only. The sheet is built from the finish-only plan, with the finish checkpoint placed at the course length and the plan curve collapsed to two points (0 m at 0 s, the course length at the curve's value there). The course length is the projection's (the route's on a legacy room with no stored length). The finish row reads the race's finish at the course end, never a stop's ETA: the attached plan's finish (read at the course end, see `POST /pacing-estimates`), else the curve's value at the course length. That is `GET /race-rooms/:roomId`'s and `GET /me/export`'s finish for the plan, and the teaser projection's finish (both count the planned stops before the finish row, never its own) when no plan is attached or the course's curve is the attached plan's (attaching writes it; a `PUT .../course` with no `course.baselineTrack` and no new route keeps the plan but puts the route model's curve back, so the projection reads that until the next attach). It is the paid schedule's on a course that ends at its finish. A course re-saved to start or end at a priced stop never carries that stop's ETA. No response carries the curve. |

Teaser projection and schedule responses carry `locked: { checkpointIds }`: every checkpoint between the start and the finish, in course order. Paid responses never do. Every other member, and every other gated route, still gets 402. An expired race stays 403 for everyone.

Crew-facing actions need a paid race for everyone, the runner included: crew chat (messages, photos, diagnostics), every invite (any role, `athlete` included), and any invite accept or code join by someone who does not hold the runner seat (the race athlete or the room creator) answer **402** `{ "error": "Race not unlocked", "code": "room_unpaid" }`. The runner's own seat is not refused this way.

Every other route that answers a member of an unpaid race with a room (`POST /race-rooms` and its idempotent retry or reclaim, which answers from the room as it is now and gives another account reusing the key 409, `GET /race-rooms/mine`, `GET /teams/:teamId/race-rooms`, join-by-code for an existing member, invite accept, `PATCH`/`DELETE .../members/...`) shapes it with `roomForViewer`: the runner gets the room teaser above; anyone else gets the room without `pacingEstimate`, `pacingEstimateId` or `course.baselineTrack` (name, code, roster, entitlement and course stay, so lists and the paywall render). The anonymous `GET /race-rooms/join-preview/:roomCode` omits `baselineTrack` on an unpaid race.

**Where an estimate went.** Estimate ids follow their inputs (no room, no user), so one stored estimate can serve several races. It records a set of rooms (`roomIds`): every race `POST /pacing-estimates` computed it for and every race it was attached to. A save adds its race and never removes another, so computing on an unpaid race with the same course and start as a paid one keeps the paid race in the set. It also records the course length it was computed for (an inline snapshot attached to a paid race takes that race's length). Attaching (by id, or an inline snapshot that reuses its id) is allowed when the target race is in the set or the estimate is already its plan of record. It is **402** `room_unpaid` only when the set names another race that is currently unpaid and names neither the target nor a paid race the caller belongs to, so a paid race cannot unlock an unpaid race's plan. Once that race is paid, the estimate attaches anywhere.

`GET /me/export` returns a stored estimate whole only when it is tied to a paid race the caller belongs to: a race in its set is paid, or it is the plan of record of a paid race of theirs. Everything else exports finish-only: an unpaid race's estimates, an expired race's, and room-less ones. A room-less estimate later attached to a paid race exports whole. Rows stored before this set was tracked (no `provenanceVersion` in the stored payload, from before #724 or written by #724 with one `roomId`) are exported whole while the caller has no unpaid race, as they were before the teaser; once the caller has one, the rule above applies to them too (a #724 row's `roomId` counts as its set). Any later save writes the row in the current format.

`POST /pacing-estimates` without `roomId` (checkpoints and `raceStartAt` in the body) prices whatever checkpoints are posted, including a course copied from an unpaid race, so it always answers finish-only, for everyone, paid races included. No shipped client calls it without `roomId`.

Both `POST /pacing-estimates` and `PUT /race-rooms/:roomId/pacing-estimate` are limited to 20 requests an hour per user (all races together; **429** with `retry-after` past that). `PUT /race-rooms/:roomId/course` and `PATCH /race-rooms/:roomId/race-start` on an unpaid race share a limit of 10 an hour per user, applied by the handler with the same counters ([rateLimit.ts](../../services/api/src/plugins/rateLimit.ts) `CONDITIONAL_RATE_LIMITS`, `enforceRateLimit`): a spent budget is refused after the payload parses and after the idempotency replay check, before the course is recomputed, and a save is counted only just before it writes (a start change is counted after its payload parses and its replay check, just before it writes). Paid saves are not counted.

Ping ingest (`POST .../pings` and `POST .../pings/batch`) is **402** on an unpaid race, the runner included. Were that gate opened, both replies carry the teaser projection, as `GET .../projection` does: its finish is from the start line, so the position a ping reports does not move it.

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

### `PATCH /race-rooms/:roomId/race-start`

Sets or changes the race start without re-sending the course (onboarding: the runner sets it, also before paying, and changes it on race morning). Same gates as `PUT .../course`: a course editor (`athlete`, `crew_chief`, `team_manager`); on an unpaid race only the runner, answered with the teaser. `raceStartAt` and the legacy `activatedAt` move together, as on a course save. Nothing else on the room changes (course, crew state) but the plan of record's clocks (below).

Pings are judged against the new start (see [Pings before the race start](#pings-before-the-race-start)). With no race ping yet (a delayed start can make every ping pre-start), the projection is re-seeded at the new start with only the crew's check-ins kept: no position, crossing, auto visit or stop from a ping that is pre-start now, so it is the projection and schedule of a room that had the new start from the outset. Its finish is the new start plus the plan. With race pings, it is recomputed over the last one, without the auto visits pre-start pings made, and with the start crossing moved to the new start. `GET .../schedule` reads the start on every request, so every row moves with it.

The attached plan of record (`pacingEstimate`) keeps its elapsed times; its clocks (`expectedFinishAt`, `bands.*.finishAt`, `aidEtas[].clockArrivalAt`) are re-anchored at the new start plus those elapsed seconds. A `PUT .../course` that moves the start and keeps the plan does the same. The plan is not recomputed: under the tuned projection constants (off by default) its night factor was computed for the old start until the runner recalculates.

Send `Idempotency-Key` to retry safely: a replay answers the room as it is now, shaped for the caller (the teaser after a refund), never the stored body; the same key with another body is **409**. On an unpaid race each change that writes counts toward the course-save limit (above).

**Body (JSON)** (`RaceRoomRaceStartPayload`)

| Field | Type | Notes |
| --- | --- | --- |
| `raceStartAt` | ISO 8601 UTC string | required; must end in `Z` (no offset), as `PUT .../course` takes it |

**Responses**

| Code | Meaning |
| --- | --- |
| 200 | Returns the updated `RaceRoom` (the teaser for the runner of an unpaid race) |
| 400 | `{ "error": "Invalid race start payload" }` (missing, not a datetime, or an offset) |
| 401 | Missing/invalid JWT or malformed claims |
| 402 | Entitlement unpaid (anyone but the runner) |
| 403 | Not a member, not a course editor, or entitlement expired |
| 404 | Unknown `roomId` |
| 409 | `Idempotency-Key` reused with another body, or still in progress |
| 429 | Unpaid race: the course-save limit is spent |

### Pings before the race start

A ping recorded before `raceStartAt` is a pre-start (test) ping: the runner's "test tracking now" days before the race, or one sent on race morning before the gun. It is accepted and stored (track, history), and the latest one still shows the runner's dot, but it never moves the projection, its ETAs, the schedule's closed visits or the projection's freshness: the ping reply carries no `projection`, `GET .../projection` stays the pre-race one (`projectionConfidence` stays `degraded`), and its `uploadIntervalSeconds` is not adopted. A pre-start ping is never the reference for the next ping's speed check, so a test ping from home never gets the race's first ping refused as `implausible_motion`; pings stay in `recordedAt` order (`stale_recorded_at`), and a race ping is always after a pre-start one. A backlog upload (`POST .../pings/batch`) may still carry samples from up to an hour before the start once the race has begun; they are stored, and only the samples from the start on drive the projection.

`GET .../pings/latest` marks a pre-start ping `preStart: true` and sends `progressMeters: 0`: the race has not begun, wherever the ping was taken. (A client that finds no `progressMeters` snaps the ping to its nearest checkpoint, so a test ping at a point-to-point course's finish lot would otherwise read as a finished race.) Client-core puts a pre-start runner at the start and makes no on-track call for it; the dot and the last-ping age still show. `GET .../pings/track` marks each pre-start point the same way, and clients do not draw those points as the runner's path. Both judge against the start as it is now, so moving the start re-marks stored pings. A room with no `raceStartAt` (legacy, `activatedAt` only) has no pre-start pings.

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
