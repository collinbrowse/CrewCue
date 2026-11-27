# Race rooms API (staging contract)

This document describes the **current** HTTP surface for race rooms, invites, and entitlement updates implemented in `services/api/src/routes/raceRooms.ts`. Payloads and responses align with `@crewcue/contracts` types where noted.

## Authentication

All routes except `/health` run the auth hook (`services/api/src/plugins/auth.ts`, `onRequest`, before the body is read):

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
| Replace the course or move the start (`PUT .../course`, `PUT .../map-workspace`, `PATCH .../race-start`; refused once the race is locked, see [Race lock](#race-lock)), rename the race (`PATCH /race-rooms/:roomId`) | `athlete`, `crew_chief`, `team_manager` (`canEditRaceSetup`) |
| Edit course details: checkpoints, planned stops, stop plans (`POST`/`PATCH`/`DELETE .../checkpoints`, `PATCH .../checkpoint-stops`, `PUT`/`PATCH`/`DELETE .../stop-plans/:checkpointId`) | `athlete`, `crew_member`, `crew_chief`, `team_manager` (`canEditCourse`) |

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
| `POST /pacing-estimates` with `roomId` | allowed; the response is finish-only (`aidEtas` empty; finish fields and bands stay). The stored estimate is whole, so paying unlocks every ETA without a recompute. The model simulates the whole route and reads the finish (expected and bands) at the course length (the same length as the attach check above, the route's on a legacy room), paid races included, so checkpoints that stop short of the route's end (a GPX with no finish waypoint, a finish dropped, a priced stop last) still get the finish at the end of the route, never the last stop's ETA. A request without `roomId` still reads it at the farthest checkpoint. The estimate records that length. A paid race's schedule puts that finish on its farthest checkpoint only when the checkpoint is the finish (at the course's end, within 1% of the course length or 100 m, whichever is larger, or marked `finish` by its id, title or a tag, as the projection reads it); a last aid station short of it keeps the plan's own ETA there, and the schedule adds a finish row at the route's end (see `GET .../schedule` below). The schedule reads the same course length as the projection, the route's on a legacy room with no stored length, never the farthest checkpoint's. Crew get 402. |
| `GET /race-rooms/:roomId/projection` | 200. `checkpointSplits` and `remainingCheckpointEtas` are empty; course-level fields stay. `etaFinishPlanIso` is always the finish from the start line (the plan curve to the course length plus every planned stop before the finish, never the finish checkpoint's own, picked as the paid projection picks it, so on a course with no finish checkpoint every stop counts, the last aid's too, and paying shows the same finish; never earlier than the projection; without a plan curve, planned pace from the start, or from when the projection was taken once the race has begun), and there is no `etaFinishWindow`, before or after any accepted ping: the projection measures its own finish from where it places the runner (the first listed checkpoint, or the last ping), which the runner chooses, and the finish from a mid-course point is the finish minus that point's ETA. |
| `GET /race-rooms/:roomId/schedule` | 200. `stops` keeps the start and the finish only. The sheet is built from the finish-only plan, with the finish checkpoint placed at the course length and the plan curve collapsed to two points (0 m at 0 s, the course length at the curve's value there). The course length is the projection's (the route's on a legacy room with no stored length). The finish row reads the race's finish at the course end, never a stop's ETA: the attached plan's finish (read at the course end, see `POST /pacing-estimates`), else the curve's value at the course length. On a course with no finish checkpoint (its checkpoints stop short of the route's end and none is marked the finish) the finish row is the route-end finish row, as on a paid sheet, and the last checkpoint is locked with the others. That is `GET /race-rooms/:roomId`'s and `GET /me/export`'s finish for the plan, and the teaser projection's finish (both count the planned stops before the finish, never a finish checkpoint's own) when no plan is attached or the course's curve is the attached plan's (attaching writes it, built from the plan's own ETAs and finish when the plan was stored without one, was computed for this course length, and the course carries no curve of the client's own; a `PUT .../course` with no `course.baselineTrack` and no new route keeps the plan but puts the route model's curve back, so the projection reads that until the next attach). It is the paid schedule's on a course that ends at its finish. A course re-saved to start or end at a priced stop never carries that stop's ETA. No response carries the curve. |

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

### Unpaid races: at most 3, deleted after 30 days

An unpaid race costs the server work (GPX parsing, estimator runs) before anyone pays, so unpaid races are limited ([billingEntitlement.ts](../../services/api/src/lib/billingEntitlement.ts) `UNPAID_RACE_LIMIT`, [unpaidRaceExpiryScheduler.ts](../../services/api/src/lib/unpaidRaceExpiryScheduler.ts)), and its creator is reminded before one is deleted ([unpaidRaceReminderScheduler.ts](../../services/api/src/lib/unpaidRaceReminderScheduler.ts)).

**At most 3 at once.** An account may have created at most 3 races whose entitlement is `unpaid`. `POST /race-rooms` past that answers **409** with an `UnpaidRaceLimitError` body:

```json
{ "error": "You have 3 races that aren't unlocked yet. Unlock or delete one to add another.", "code": "unpaid_race_limit", "limit": 3 }
```

- A race counts toward its creator (`createdByUserId`, from the token; the first member on a room stored before #649), not toward `athleteId`: the client sets `athleteId` (risk R17), so counting it would let anyone fill another runner's limit. A race someone else created naming you the runner, and a race you only crew, don't count toward yours.
- `paid` and `expired` races don't count, and neither does a race that was ever paid: one with any billing grant, active or revoked. A refund (RevenueCat `CANCELLATION`, or `EXPIRATION`) revokes the grant and puts the race back to `unpaid`, but it was paid once, so it doesn't count again. (Setting a race back to `unpaid` through the dev and staging entitlement route records no grant, so that race counts.)
- The count reads the store every instance shares (the stored rows in Postgres, through a partial index of unpaid rooms by creator), not an instance's cache. Creates by one account are counted and saved one at a time per instance, so two at once cannot both take the last slot; creates that reach two instances at the same moment can each pass (R1), one race over per extra instance.
- The refused create is not stored against its `Idempotency-Key`: the same key works once a race is unlocked or expires. A retry of a create that already succeeded still answers its room.

**Reminders before the delete.** The race's creator (`createdByUserId`, else the first member), who is the one who pays, whatever role they chose, gets up to three pushes; no other member gets them. They go out only while the race is `unpaid`, was never paid (no billing grant, active or revoked), and its creator has no purchase stored with no room (below). Each goes out once:

| Slot | Due once | Body |
| --- | --- | --- |
| `expiry_7d` | `createdAt` + 23 days has passed, unless `expiry_1d` is due too | "Your race *name* will be deleted in *N* days. Unlock it to keep your course and plan." |
| `expiry_1d` | `createdAt` + 29 days has passed | "Your race *name* will be deleted tomorrow. Unlock it to keep your course and plan." |
| `race_soon` | `raceStartAt` − 3 days has passed, while the start is still ahead and before the race's expiry time (`unpaidExpiresAt`) | "Your race *name* is in *N* days. Unlock it so your crew can follow you." |

- The title is "Unlock your race". *N* is whole days to the delete (or the start), rounded down, at least 1 ("1 day"); no clock times. The copy is in [unpaidRaceReminderCopy.ts](../../services/api/src/lib/unpaidRaceReminderCopy.ts).
- "Due once" means catch-up, not a window: a server that was down, or a race created before the reminders shipped, gets the reminder on the next tick. A race already past day 29 gets `expiry_1d` only. When `expiry_1d` and `race_soon` are both due, `expiry_1d` is claimed first; its claim moves the expiry time to a day later, which can make `race_soon` due in the same tick. Then `race_soon` is sent first and `expiry_1d` last: they share a collapse key and the phone keeps the last one, so the deletion warning is the one left on the phone. When `expiry_7d` and `race_soon` are both due, they are sent in claim order, `race_soon` last, so the race a few days off is the one left.
- A tick every 15 minutes lists the candidates through a slim query over the unpaid partial indexes (by `createdAt`, and by `raceStartAt` from migration 0023): id, entitlement status, `createdAt`, `raceStartAt`, creator, whether the creator is still on the roster, name and the race's claims, never the payload. It runs on every instance, started after `listen` and stopped on shutdown (it ends a pass between two races).
- Each reminder is claimed in `unpaid_reminders_sent` (primary key room and slot, rows deleted with the room) before it is sent, and only the instance whose insert won sends it, so several instances send it once. The claim re-checks the race in the same statement (Postgres: the row goes in only while the stored race is still `unpaid` with no grant, and its creator has no unattached grant; memory mode checks the grants just before), so a race paid while a pass works through earlier races gets neither a claim nor a push. A race's slots are sent only once all of its claims in that pass are settled: if `race_soon`'s claim finds the race paid or deleted just after `expiry_*` was claimed, neither is sent, and the `expiry_*` claim stays. A crash between the claim and the send skips it; it is never sent twice. A creator with no push device, or no longer on the roster, still gets the claim: the slot counts as passed.
- The push goes through the chat push transports with `type: "unlock"` and `roomId`, collapse key `unlock:<roomId>` (a newer reminder replaces an older unread one, never a chat, schedule or tracking push), and an expiry (`apns-expiration`, FCM `android.ttl`): 24 hours for `expiry_*`, the race start for `race_soon`. Neither app routes an `unlock` tap yet; tapping one opens the app.

**Deleted after 30 days, a day after the last reminder.** A race still `unpaid` 30 days after its `createdAt`, never paid, and whose `expiry_1d` reminder was claimed at least 24 hours before, is deleted, with everything keyed by it: the room (course, schedule, stop plans), invites, task board, pings and track, projection, crew chat, tracking and unpaid-race reminder claims, the finished effort and the course-history record. It is the same delete as account deletion's ([raceRoomDeletion.ts](../../services/api/src/lib/raceRoomDeletion.ts)). Afterwards every route for the race answers **404**, by id and by join code. A race created long ago (before the reminders shipped, or while the server was down) gets its 1-day reminder on the first reminder tick and is deleted 24 hours later at the soonest.

- A sweeper checks every hour, deleting the oldest expired races first, at most 100 a tick; races whose creator was warned under a day ago are not listed. Before deleting anything, and again as it deletes the room row, it re-reads the race under its room lock (Postgres: the stored row, locked `FOR UPDATE` until the delete commits, with the grants and the reminder claim read in the same transaction) and keeps it unless it is still `unpaid`, still 30 days old, warned at least a day ago, has no billing grant, and its creator has no unattached grant.
- A grant write takes the room row `FOR KEY SHARE` in its own transaction ([billingStore.ts](../../services/api/src/lib/billingStore.ts) `upsertBillingGrant`), so a purchase either commits before the sweeper locks the row (the sweeper then keeps the race) or waits for the delete and is stored for a room that is gone (risk R25); it never lands between the sweeper's last check and the delete. Room saves don't wait on that lock.
- `paid` and `expired` races are never deleted this way, and neither is a race that was ever paid (any grant, a refunded one included): a race paid, raced and then refunded keeps its track and crew chat. A race with no parsable `createdAt` is kept.
- A purchase the webhook could not attach to a race (the event had no `crewcue_room_id`, or named an unknown room) is stored with `room_id` null (risk R25), so its buyer may be paying for a race that still reads `unpaid`. While its creator has such a grant, active or revoked, none of the races they created gets a reminder, `unpaidExpiresAt`, or the delete. The grant is matched on `app_user_id`: the apps sign RevenueCat in with the CrewCue user id (the token's `sub`, which rooms store as `createdByUserId`) before they buy. A grant stored with no room takes no room lock, so one that lands between the sweeper's last check and its delete does not stop that delete.
- The room row is deleted after chat, the finished effort and the course history, so a delete that fails or is cut off partway (a deploy's shutdown ends the batch between two races and waits 5 s for the one in flight) leaves the race listed, and the next tick runs the whole delete again. Chat photos are deleted before their messages for the same reason, and the sweeper's delete fails when the photo bucket deleted fewer photos than it was given (a 403 or 5xx), so the keys stay for the retry. Account deletion and chat retention go on past such a photo.
- Billing grants for a deleted race stay, as for account deletion (refunds and store reconciliation).
- The apps have no copy for `unpaid_race_limit` yet.
- The 409 says "Unlock or delete one", but there is no route yet for a runner to delete one race (only account deletion deletes races). Until there is, a runner at the limit can unlock a race or wait for one to expire.

**`unpaidExpiresAt`.** `GET /race-rooms/:roomId` and `GET /race-rooms/mine` add `unpaidExpiresAt` (ISO) to an unpaid race that was never paid: when the sweeper deletes it, the later of `createdAt` + 30 days and, once `expiry_1d` was claimed, that claim + 24 hours. It is computed for the response and never stored. Paid and expired races, races paid once, races whose creator has a purchase stored with no room, and a race with no parsable `createdAt` don't carry it, nor do other routes' room payloads.

## Endpoints

### `POST /race-rooms`

Creates a draft room; creator becomes the first member with `creatorRole`.

**Body (JSON)**

| Field | Type | Notes |
| --- | --- | --- |
| `teamId` | string | required, at most 200 characters |
| `athleteId` | string | required |
| `name` | string | required, at most 200 characters |
| `creatorName` | string | optional, at most 120 characters |
| `description` | string | optional, at most 2,000 characters |
| `crewName` | string | optional, at most 120 characters |
| `creatorRole` | role enum | optional, default `athlete` |

**Responses**

| Code | Meaning |
| --- | --- |
| 201 | Returns the full `RaceRoom` resource |
| 400 | Invalid payload |
| 401 | Missing/invalid JWT or malformed claims |
| 409 | `unpaid_race_limit`: the caller already created 3 races that are still unpaid ([above](#unpaid-races-at-most-3-deleted-after-30-days)); or `Idempotency-Key` reused by another account, with another body, or still in progress |

### `GET /race-rooms/:roomId`

Returns `{ room, permissions }` for the caller’s membership role. On an unpaid race that was never paid, `room.unpaidExpiresAt` says when it is deleted ([above](#unpaid-races-at-most-3-deleted-after-30-days)); `GET /race-rooms/mine` adds it to each such race too.

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

Sets or changes the race start without re-sending the course (onboarding: the runner sets it, also before paying, and changes it on race morning). Same gates as `PUT .../course`: race setup rights (`athlete`, `crew_chief`, `team_manager`; a `crew_member` gets 403); on an unpaid race only the runner, answered with the teaser. `raceStartAt` and the legacy `activatedAt` move together, as on a course save. Nothing else on the room changes (course, crew state) but the plan of record's clocks (below).

Pings are judged against the new start (see [Pings before the race start](#pings-before-the-race-start)). With no race ping yet (a delayed start can make every ping pre-start), the projection is re-seeded at the new start with only the crew's check-ins kept: no position, crossing, auto visit or stop from a ping that is pre-start now, so it is the projection and schedule of a room that had the new start from the outset. Its finish is the new start plus the plan. With race pings, it is recomputed over the last one, without the auto visits pre-start pings made, and with the start crossing moved to the new start. A `PUT .../course` that moves the start does the same, so the start split and the finish move with it either way. `GET .../schedule` reads the start on every request, so every row moves with it.

The attached plan of record (`pacingEstimate`) keeps its elapsed times; its clocks (`expectedFinishAt`, `bands.*.finishAt`, `aidEtas[].clockArrivalAt`) are re-anchored at the new start plus those elapsed seconds. A `PUT .../course` that moves the start and keeps the plan does the same, and `PUT .../pacing-estimate` attaches a plan with its clocks at the start as it is now, also one computed before the start moved (the stored estimate keeps its own). The plan is not recomputed: under the tuned projection constants (off by default) its night factor was computed for the old start until the runner recalculates.

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
| 403 | Not a member, no race setup rights, or entitlement expired |
| 404 | Unknown `roomId` |
| 409 | `Idempotency-Key` reused with another body, or still in progress; or `{ "code": "race_locked" }` (see [Race lock](#race-lock)) |
| 429 | Unpaid race: the course-save limit is spent |

### Race lock

A Race Pass pays for one race. Once the race is used, its route line and start are locked so the paid room cannot be re-pointed at another race ([raceLock.ts](../../services/api/src/lib/raceLock.ts)). A **paid** room is locked from the first of:

- the runner reaching the first aid station (the course's first checkpoint after the start) on race pings (`POST .../pings` or `POST .../pings/batch`): the projection's crossing time there, at or after `raceStartAt`, stored once as `raceLockedAt`, with no write on later pings;
- the current `raceStartAt` + 48 hours, with or without pings (computed, never stored).

Pings at the start line, test pings, and a runner waiting out a delayed or postponed start never lock the race: until the first aid station the start can move by any amount and the course can be replaced. A course with no checkpoint after the start is locked only by the 48-hour rule.

An unpaid or expired room is never locked, whatever is stored (a refund unlocks; paying again relocks). Room responses (`GET /race-rooms/:roomId`, `GET /race-rooms/mine`, every route that answers a room) carry the effective lock as `raceLockedAt`: the stored time, else start + 48 h once that has passed, absent when unlocked.

Locked, these answer **409** `{ "error": "<sentence>", "code": "race_locked" }` and write nothing:

- `PUT .../course` with a different route line (`routeOverlayLayer` whose geometry differs from the stored driving layer), a different `courseGpxXml`, or a start the lock does not allow;
- `PUT .../map-workspace` that changes the projection-driving layer's geometry;
- `PATCH .../race-start` to a start the lock does not allow.

The start may stay as it is, and on a room locked at the first aid station it may be set anywhere in the 12 hours before that arrival, never after it (a start entered at the wrong hour; anchored to the lock, so moves cannot be chained). On a room locked only by the 48-hour rule it may not move. Still open: `PATCH /race-rooms/:roomId` (rename), `PUT .../course` with the same route and start (checkpoint and aid-station edits), checkpoint add/edit/delete, planned stops, map-workspace edits that keep the driving line, and `POST .../course/gpx-preview` (it saves nothing).

### `PATCH /race-rooms/:roomId`

Renames the race. Same gates as `PATCH .../race-start`: race setup rights (`athlete`, `crew_chief`, `team_manager`; a `crew_member` gets 403); on an unpaid race only the runner, answered with the teaser. Open on a locked race. No event is published: crew clients read the new name on their next `GET /race-rooms/mine` or room read.

**Body (JSON)**

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | required; trimmed, 1 to 80 characters |

**Responses**

| Code | Meaning |
| --- | --- |
| 200 | Returns the updated `RaceRoom` (the teaser for the runner of an unpaid race) |
| 400 | `{ "error": "Race name must be 1 to 80 characters." }` |
| 401 | Missing/invalid JWT or malformed claims |
| 402 | Entitlement unpaid (anyone but the runner) |
| 403 | Not a member, no race setup rights, or entitlement expired |
| 404 | Unknown `roomId` |

### Pings before the race start

A ping recorded before `raceStartAt` is a pre-start (test) ping: the runner's "test tracking now" days before the race, or one sent on race morning before the gun. It is accepted and stored (track, history), and the latest one still shows the runner's dot, but it never moves the projection, its ETAs, the schedule's closed visits or the projection's freshness: the ping reply carries no `projection`, `GET .../projection` stays the pre-race one (`projectionConfidence` stays `degraded`), and its `uploadIntervalSeconds` is not adopted. A pre-start ping is never the reference for the next ping's speed check, so a test ping from home never gets the race's first ping refused as `implausible_motion`; pings stay in `recordedAt` order (`stale_recorded_at`), and a race ping is always after a pre-start one. A backlog upload (`POST .../pings/batch`) may still carry samples from up to an hour before the start once the race has begun; they are stored, and only the samples from the start on drive the projection.

`GET .../pings/latest` marks a pre-start ping `preStart: true` and sends `progressMeters: 0`: the race has not begun, wherever the ping was taken. (A client that finds no `progressMeters` snaps the ping to its nearest checkpoint, so a test ping at a point-to-point course's finish lot would otherwise read as a finished race.) Client-core puts a pre-start runner at the start and makes no on-track call for it; the dot and the last-ping age still show. `GET .../pings/track` marks each pre-start point the same way, and clients do not draw those points as the runner's path. Both judge against the start as it is now, so moving the start re-marks stored pings. Each `pings/track` page names the start it judged against (`raceStartAt`): a client holding points read under another start should drop them and its cursor and read the track from the beginning, so every phone draws the same line (client-core does not do this yet). A projection stored before pre-start pings were ignored, while every accepted ping is pre-start, is re-seeded at the start (crew check-ins kept) on the next projection or schedule read, unless the race is completed or expired, or no projection can be seeded at the start (then it stays as stored). A crew check-in keeps its `visitIndex` when an auto visit before it is dropped (the start moved past it): indexes are never renumbered, so a dropped visit leaves a gap. A room with no `raceStartAt` (legacy, `activatedAt` only) has no pre-start pings.

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
| 403 | Not a member (every member role may edit course details), or entitlement |
| 404 | Unknown room, no course, or unknown checkpoint ids (`checkpointIds` lists them; nothing is saved) |

## Input limits

- **Request bodies** are capped at 1 MB. Routes that take files have their own cap: `PUT .../course` about 24 MB (the GPX preview plus `courseGpxXml`), `PUT .../map-workspace` 8 MB, `POST .../course/gpx-preview` and `POST /activity-history/gpx` about 20 MB (a 10 MB `gpxXml`), the activity file, preview and archive routes their base64 file cap, `POST /activity-history/upload` 200 MB, chat photos 10 MB. An oversized body answers **413** `{ "error", "code" }` (`file_too_large` on file routes, else `body_too_large`). These routes answer **401** before reading the body when the token is missing or invalid.
- **Course and map workspace**: `courseGpxXml` at most 10 MB of text (the GPX upload cap), `courseFileName` 500 characters, at most 500 checkpoints, 10,000 baseline points, 20,000 vertices per route line and 100 lines per layer; ids at most 200 characters.
- **Room codes** are 6 digits from a CSPRNG (the apps take exactly 6). `POST /race-rooms/join-by-code` and `GET /race-rooms/join-preview/:roomCode` share a budget of codes that match no room: 20 per hour per account (per client address when signed out) and 500 per hour across everyone, kept in Postgres so every instance shares it (`join_code_failures`, migration 0024). Past it they answer **429** `Too many requests` with `retry-after`, before looking the code up.

## Notes for consumers

- In-memory stores reset on process restart; treat this as a **contract + behavior sketch** until persistence lands in a later slice.
- Distinct **402** vs **403** errors are intentional for billing UX vs hard entitlement expiry.
