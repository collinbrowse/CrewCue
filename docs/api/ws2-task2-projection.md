# WS2 Task 2 — Deterministic split and ETA projection

## Purpose

After each **accepted** athlete ping, the API recomputes a **projection**: progress along the course polyline, per-checkpoint split rows (planned vs actual elapsed time when a checkpoint has been crossed), and a **plan-pace ETA** to the finish. The model is **deterministic** (same inputs → same outputs) for tests and operator trust.

## Course and plan baseline

On **`POST /race-rooms/:roomId/activate`** the room gains:

| Field | Source |
| --- | --- |
| `course` | Optional body `course.checkpoints` (≥ 2). Each checkpoint has `id`, `latitude`, `longitude`. If omitted, a default straight-line course is applied. |
| `plannedPaceSecondsPerKm` | Optional positive number. If omitted, **480** (8 minutes per km). |

Checkpoints form an ordered **polyline**. Distances use a local equirectangular projection anchored at the first checkpoint (consistent for progress and cumulative split distances).

## Recompute trigger

When **`POST /race-rooms/:roomId/pings`** returns **201** (`decision: "accepted"`), the server:

1. Projects the ping onto the polyline → `progressMeters` (0…`courseLengthMeters`).
2. Updates **first crossing** times for checkpoints (checkpoint `b` when progress first reaches its cumulative distance). The start checkpoint is stamped with `activatedAt` on the first accepted ping.
3. Builds `checkpointSplits[]` with planned elapsed at each checkpoint (`distanceKm × pace`), actual elapsed when crossed (`crossedAt − activatedAt`), and `delta = actual − planned`.
4. Computes **`etaFinishPlanIso`**: `recordedAt` of the ping plus remaining distance at **plan pace**.

The **201** response may include a **`projection`** object (same shape as GET, including timeliness — see below). If projection math fails, the ping is still accepted and a warning is logged (`projection_recompute_failed`).

## `GET /race-rooms/:roomId/projection`

Same auth, membership, and entitlement rules as `GET /race-rooms/:roomId`.

| Code | When |
| --- | --- |
| **200** | Latest projection exists (at least one accepted ping since activation). |
| **404** | Room missing, or no projection yet. |
| **401** / **403** / **402** | Standard auth / membership / entitlement. |

Response body matches `RaceRoomProjection` in `@crewcue/contracts` (core split/ETA fields plus **staleness / confidence** — [ws2-task3-projection-confidence.md](./ws2-task3-projection-confidence.md)).

## Logging

Structured log **`projection_recompute`** with `roomId`, `pingId`, `progressMeters`, `courseLengthMeters` (no coordinates in this line).

## Notes

- Projection state is **in-memory** and cleared when the process restarts; activation clears prior projection state for that `roomId`.
- Rejected pings do not advance projection; only **accepted** pings trigger recompute.
