# WS2 Task 3 — Projection confidence and staleness

## Purpose

The **numeric projection** (progress, splits, plan ETA) updates only on **accepted** pings. This document describes how the API answers: **is that snapshot still credible right now?** and how the **staleness window** ties to the athlete’s declared **ping interval**.

## Response shape (`RaceRoomProjection`)

Built from **`RaceRoomProjectionCore`** (deterministic math) plus **`ProjectionTimeliness`**:

| Field | Meaning |
| --- | --- |
| `projectionConfidence` | `"fresh"` if time since last accepted ping’s **`recordedAt`** ≤ effective threshold; otherwise `"degraded"`. |
| `stalenessThresholdSeconds` | Effective threshold used for this response (see below). |
| `secondsSinceLastAcceptedPing` | Seconds between that `recordedAt` and **`evaluatedAt`** (≥ 0). |
| `evaluatedAt` | ISO time when timeliness was computed (server clock). |

## How `stalenessThresholdSeconds` is chosen

1. **Client-declared interval (preferred):** If the room has a stored **`uploadIntervalSeconds`** from the latest accepted ping that included this field, the threshold is  
   **`min(3 × uploadIntervalSeconds, 15 minutes)`** (900 seconds max).

2. **Fallback:** If no interval has been declared yet, use **`min(PROJECTION_STALE_AFTER_SECONDS, 15 minutes)`** (defaults to **900** when env is unset). Invalid or non-positive env values fall back to the same **15m** cap.

The athlete app is expected to derive **`uploadIntervalSeconds`** from **battery mode** (e.g. high performance vs battery saver) and **expected race duration** (shorter races → lower interval). Server-side mapping of modes to seconds is **not** implemented here — see [mobile-athlete-ping-battery-deferred.md](../sdlc/mobile-athlete-ping-battery-deferred.md).

## Where timeliness appears

- **`GET /race-rooms/:roomId/projection`** — recomputed on every request.
- **`POST .../pings` `201`** body **`projection`** — evaluated immediately after accept.

## Manual smoke

1. Send a ping **with** `uploadIntervalSeconds: 40` → `GET .../projection` → `stalenessThresholdSeconds` should be **120**, usually **`fresh`** right away.
2. Omit the field → threshold **900** (unless env overridden below 15m).
3. Wait longer than the effective threshold without a new accepted ping → **`degraded`**.

## Notes

- The server **trusts** the declared interval for UX thresholds only; abuse mitigation (caps, anomaly detection) is **deferred**.
- In-memory state resets on process restart.
