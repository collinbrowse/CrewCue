# WS2 Task 3 — Projection staleness and confidence

## Purpose

The **math projection** (splits, progress, plan ETA) updates only when pings are **accepted**. Clients still need to know whether that snapshot is **trustworthy right now**. Task 3 adds **timeliness** fields so UIs can show “live” vs “stale feed” without guessing.

## Response shape

`RaceRoomProjection` in `@crewcue/contracts` is `RaceRoomProjectionCore` plus:

| Field | Meaning |
| --- | --- |
| `projectionConfidence` | `"fresh"` — last accepted ping’s `recordedAt` is within the staleness window; `"degraded"` otherwise. |
| `stalenessThresholdSeconds` | Server policy (see below). |
| `secondsSinceLastAcceptedPing` | Seconds between that `recordedAt` and when the response was built (≥ 0; server clock). |
| `evaluatedAt` | ISO timestamp when timeliness was computed (usually “now” on the server). |

Core fields (`progressMeters`, `checkpointSplits`, `etaFinishPlanIso`, etc.) still reflect the **last accepted ping** only; they are **not** extrapolated forward in this slice.

## Where it appears

- **`GET /race-rooms/:roomId/projection`** — timeliness is recomputed on **every** request from the latest accepted ping.
- **`POST .../pings`** **201** body `projection` — timeliness is evaluated immediately after accept (typically `fresh`).

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `PROJECTION_STALE_AFTER_SECONDS` | `120` | If `secondsSinceLastAcceptedPing` exceeds this value, `projectionConfidence` is `degraded`. Invalid or non-positive values fall back to the default. |

## Manual smoke

1. Activate a paid room with a small `course`, send a ping with `recordedAt` ≈ now → `GET .../projection` → `projectionConfidence: "fresh"`.
2. Wait longer than `PROJECTION_STALE_AFTER_SECONDS` without sending another ping → same `GET` → `degraded`, `secondsSinceLastAcceptedPing` above threshold.
3. Send another accepted ping → `fresh` again.

## Notes

- Staleness uses the **device `recordedAt`** on the last **accepted** ping (same time basis as ping validation), not server receive time alone.
- In-memory state still resets on process restart.
