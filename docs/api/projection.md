# Split and ETA projection

## Purpose

After each **accepted** athlete ping recorded from the race start on, the API recomputes a **projection**: progress along the course polyline, per-checkpoint split rows (planned vs actual elapsed time when a checkpoint has been crossed), and a **plan-pace ETA** to the finish. The model is **deterministic** (same inputs → same outputs) for tests and operator trust.

## Course and plan baseline

New race rooms are created **`status: "active"`** (no separate activation step).

**`PUT /race-rooms/:roomId/course`** (with a `course` body) is the primary setup path. It **requires** `raceStartAt` (ISO 8601) and `plannedPaceSecondsPerKm`. The server persists `raceStartAt` on the room and mirrors the anchor into legacy **`activatedAt`** for elapsed-time math. **`PATCH /race-rooms/:roomId/race-start`** sets or changes the start alone, the same way, and recomputes the projection ([race-rooms.md](race-rooms.md#patch-race-roomsroomidrace-start)).

| Field | Source |
| --- | --- |
| `course` | Body `course.checkpoints` (≥ 2). Each checkpoint has `id`, `latitude`, `longitude`. |
| `plannedPaceSecondsPerKm` | Required positive number when saving a course. |
| `raceStartAt` | **Required** with `course`: official race clock anchor (ISO). |

Checkpoints form an ordered **polyline**. Distances use a local equirectangular projection anchored at the first checkpoint (consistent for progress and cumulative split distances).

**Route geometry (mandatory for multi-checkpoint rooms):** progress and `courseLengthMeters` are driven by the **uploaded course route** (map workspace driving layer / route overlay), not by straight-line chords between checkpoints. Saving a course with **≥ 2** checkpoints requires usable route polyline geometry; per-checkpoint rows use **`distanceMetersFromStart`** from the route projection (no checkpoint-only fallback). **`courseLengthMeters`** in projection responses is the **canonical** course length when the server can resolve it (else derived from room + route).

## Bootstrap projection (no ping yet)

When the room has **course**, **planned pace**, and **race anchor** (`raceStartAt` / `activatedAt`), but no stored projection state, **`GET /race-rooms/:roomId/projection`** seeds a **bootstrap** projection (synthetic checkpoint-0 ping) so clients receive **200** with `checkpointSplits` before the first real ping.

While the race has no ping from the start on, a course save (`PUT .../course`, a waypoint added or removed), a plan attach, and `PATCH .../race-start` re-seed the bootstrap for the room as it is now (its course, plan and start), and put the crew's check-ins back on it (visits with a `manualEntry`, as `manual_crew`). Nothing a ping left there is kept: no position, crossing, auto visit or stop, and no adopted `uploadIntervalSeconds`. Such state can only come from pings that a later start made pre-start, or from before pre-start pings were ignored; the race's first ping re-seeds such a stored projection before it folds in.

Taken before the start, the bootstrap's finish is **the start plus the plan** (plus the planned stops before the finish), not now plus the plan: the rest of the course counts from the later of the projection's time and the race start. A pre-start ping never replaces the bootstrap.

## Pre-start pings

A ping recorded before `raceStartAt` (a test ping) is accepted and stored, and shows the runner's dot (`GET .../pings/latest` marks it `preStart: true`), but it never drives the projection: no recompute, no checkpoint crossing or visit, no freshness, and its `uploadIntervalSeconds` is not adopted. The race's first ping starts from the pre-race projection as if no ping came before it, and a pre-start ping is never the reference for its speed check. Backlog samples from before the start are stored and skipped the same way. Details in [race-rooms.md](race-rooms.md#pings-before-the-race-start).

## Recompute trigger

When **`POST /race-rooms/:roomId/pings`** returns **201** (`decision: "accepted"`) for a ping recorded at or after the race start, the server:

1. Projects the ping onto the polyline → `progressMeters` (0…`courseLengthMeters`).
2. Updates **first crossing** times for checkpoints (checkpoint `b` when progress first reaches its cumulative distance). The start checkpoint is stamped with the race anchor on the first accepted ping.
3. Builds `checkpointSplits[]` with planned elapsed at each checkpoint (`distanceKm × pace`), actual elapsed when crossed (`crossedAt − raceAnchor`), and `delta = actual − planned`.
4. Computes **`etaFinishPlanIso`**, the **arrival at the finish line**: `recordedAt` of the ping (the race start, if later) plus remaining distance at **plan pace** (with a plan curve: anchored at the last crossed checkpoint), plus the planned stops still ahead **before** the finish. The finish checkpoint (the farthest along the course, when it is at the course's end: within 1% of the course length or 100 m, whichever is larger) never adds its own `plannedStopSeconds`, nor what is left of a stop in progress there, so the finish equals the schedule's finish-row arrival. Checkpoints that stop short of the route's end (a course file with no finish waypoint) have no finish checkpoint: the finish is read at the course length, and every checkpoint's planned stop, the last aid's included, is on the way there.

The **201** response may include a **`projection`** object (same shape as GET, including timeliness — see below); a pre-start ping's reply has none. If projection math fails, the ping is still accepted and a warning is logged (`projection_recompute_failed`).

## `GET /race-rooms/:roomId/projection`

Same auth, membership, and entitlement rules as `GET /race-rooms/:roomId`. On an unpaid race the runner gets the teaser: finish-only, so `checkpointSplits` and `remainingCheckpointEtas` are empty, `etaFinishPlanIso`, `etaFinishWindow` and course-level fields stay, and `locked` lists every mid-course checkpoint. Before the runner's first accepted ping the finish is read from the start line and carries no window; see [race-rooms.md](race-rooms.md#unpaid-race-the-runners-teaser).

| Code | When |
| --- | --- |
| **200** | Latest projection exists (including bootstrap when eligible). |
| **404** | Room missing, or course/pace/anchor not yet sufficient for projection. |
| **401** / **403** / **402** | Standard auth / membership / entitlement. |

Response body matches `RaceRoomProjection` in `@crewcue/contracts` (core split/ETA plus the timeliness fields below).

## Logging

Structured log **`projection_recompute`** with `roomId`, `pingId`, `progressMeters`, `courseLengthMeters` (no coordinates in this line).

## Notes

- Projection state is **in-memory** (or persisted when WS2 runtime persistence is enabled); course changes and pings update stored state.
- Rejected pings do not advance projection; only **accepted** pings from the race start on trigger recompute from live pings.
- Legacy rooms without `raceStartAt`/`activatedAt` may still return **404** from GET projection until the course is re-saved with `raceStartAt`.

## Timeliness: confidence and staleness

The **numeric projection** (progress, splits, plan ETA) updates only on **accepted** pings. This document describes how the API answers: **is that snapshot still credible right now?** and how the **staleness window** ties to the athlete’s declared **ping interval**.

### Response shape (`RaceRoomProjection`)

Built from **`RaceRoomProjectionCore`** (deterministic math) plus **`ProjectionTimeliness`**:

| Field | Meaning |
| --- | --- |
| `projectionConfidence` | `"fresh"` if time since last accepted race ping’s **`recordedAt`** ≤ effective threshold; otherwise `"degraded"`. A pre-start ping never counts: with no race ping it stays `"degraded"`. |
| `stalenessThresholdSeconds` | Effective threshold used for this response (see below). |
| `secondsSinceLastAcceptedPing` | Seconds between that `recordedAt` and **`evaluatedAt`** (≥ 0). |
| `evaluatedAt` | ISO time when timeliness was computed (server clock). |

### How `stalenessThresholdSeconds` is chosen

1. **Client-declared interval (preferred):** If the room has a stored **`uploadIntervalSeconds`** from the latest accepted race ping that included this field (a pre-start ping's is not adopted), the threshold is  
   **`min(3 × uploadIntervalSeconds, 15 minutes)`** (900 seconds max).

2. **Fallback:** If no interval has been declared yet, use **`min(PROJECTION_STALE_AFTER_SECONDS, 15 minutes)`** (defaults to **900** when env is unset). Invalid or non-positive env values fall back to the same **15m** cap.

The athlete app is expected to derive **`uploadIntervalSeconds`** from **battery mode** (e.g. high performance vs battery saver) and **expected race duration** (shorter races → lower interval). The server does not map battery modes to seconds.

### Where timeliness appears

- **`GET /race-rooms/:roomId/projection`** — recomputed on every request.
- **`POST .../pings` `201`** body **`projection`** — evaluated immediately after accept.

### Manual smoke

1. Send a ping **with** `uploadIntervalSeconds: 40` → `GET .../projection` → `stalenessThresholdSeconds` should be **120**, usually **`fresh`** right away.
2. Omit the field → threshold **900** (unless env overridden below 15m).
3. Wait longer than the effective threshold without a new accepted ping → **`degraded`**.

### Timeliness notes

- The server **trusts** the declared interval for UX thresholds only; abuse mitigation (caps, anomaly detection) is **deferred**.
- In-memory state resets on process restart.
