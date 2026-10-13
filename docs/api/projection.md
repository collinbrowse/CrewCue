# Split and ETA projection

## Purpose

After each **accepted** athlete ping, the API recomputes a **projection**: progress along the course polyline, per-checkpoint split rows (planned vs actual elapsed time when a checkpoint has been crossed), and a **plan-pace ETA** to the finish. The model is **deterministic** (same inputs → same outputs) for tests and operator trust.

## Course and plan baseline

New race rooms are created **`status: "active"`** (no separate activation step).

**`PUT /race-rooms/:roomId/course`** (with a `course` body) is the primary setup path. It **requires** `raceStartAt` (ISO 8601) and `plannedPaceSecondsPerKm`. The server persists `raceStartAt` on the room and mirrors the anchor into legacy **`activatedAt`** for elapsed-time math.

| Field | Source |
| --- | --- |
| `course` | Body `course.checkpoints` (≥ 2). Each checkpoint has `id`, `latitude`, `longitude`. |
| `plannedPaceSecondsPerKm` | Required positive number when saving a course. |
| `raceStartAt` | **Required** with `course`: official race clock anchor (ISO). |

Checkpoints form an ordered **polyline**. Distances use a local equirectangular projection anchored at the first checkpoint (consistent for progress and cumulative split distances).

**Route geometry (mandatory for multi-checkpoint rooms):** progress and `courseLengthMeters` are driven by the **uploaded course route** (map workspace driving layer / route overlay), not by straight-line chords between checkpoints. Saving a course with **≥ 2** checkpoints requires usable route polyline geometry; per-checkpoint rows use **`distanceMetersFromStart`** from the route projection (no checkpoint-only fallback). **`courseLengthMeters`** in projection responses is the **canonical** course length when the server can resolve it (else derived from room + route).

## Bootstrap projection (no ping yet)

When the room has **course**, **planned pace**, and **race anchor** (`raceStartAt` / `activatedAt`), but no stored projection state, **`GET /race-rooms/:roomId/projection`** seeds a **bootstrap** projection (synthetic checkpoint-0 ping) so clients receive **200** with `checkpointSplits` before the first real ping. `PUT .../course` also ensures bootstrap after a successful save.

## Recompute trigger

When **`POST /race-rooms/:roomId/pings`** returns **201** (`decision: "accepted"`), the server:

1. Projects the ping onto the polyline → `progressMeters` (0…`courseLengthMeters`).
2. Updates **first crossing** times for checkpoints (checkpoint `b` when progress first reaches its cumulative distance). The start checkpoint is stamped with the race anchor on the first accepted ping.
3. Builds `checkpointSplits[]` with planned elapsed at each checkpoint (`distanceKm × pace`), actual elapsed when crossed (`crossedAt − raceAnchor`), and `delta = actual − planned`.
4. Computes **`etaFinishPlanIso`**: `recordedAt` of the ping plus remaining distance at **plan pace**.

The **201** response may include a **`projection`** object (same shape as GET, including timeliness — see below). If projection math fails, the ping is still accepted and a warning is logged (`projection_recompute_failed`).

## `GET /race-rooms/:roomId/projection`

Same auth, membership, and entitlement rules as `GET /race-rooms/:roomId`.

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
- Rejected pings do not advance projection; only **accepted** pings trigger recompute from live pings.
- Legacy rooms without `raceStartAt`/`activatedAt` may still return **404** from GET projection until the course is re-saved with `raceStartAt`.

## Timeliness: confidence and staleness

The **numeric projection** (progress, splits, plan ETA) updates only on **accepted** pings. This document describes how the API answers: **is that snapshot still credible right now?** and how the **staleness window** ties to the athlete’s declared **ping interval**.

### Response shape (`RaceRoomProjection`)

Built from **`RaceRoomProjectionCore`** (deterministic math) plus **`ProjectionTimeliness`**:

| Field | Meaning |
| --- | --- |
| `projectionConfidence` | `"fresh"` if time since last accepted ping’s **`recordedAt`** ≤ effective threshold; otherwise `"degraded"`. |
| `stalenessThresholdSeconds` | Effective threshold used for this response (see below). |
| `secondsSinceLastAcceptedPing` | Seconds between that `recordedAt` and **`evaluatedAt`** (≥ 0). |
| `evaluatedAt` | ISO time when timeliness was computed (server clock). |

### How `stalenessThresholdSeconds` is chosen

1. **Client-declared interval (preferred):** If the room has a stored **`uploadIntervalSeconds`** from the latest accepted ping that included this field, the threshold is  
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
