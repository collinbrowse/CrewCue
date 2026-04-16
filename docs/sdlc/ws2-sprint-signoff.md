# WS2 first sprint — sign-off

**Status:** Complete (baseline suitable for an **end-to-end demo** against a running API, not yet production persistence).

## What shipped

- **Task 1 — Ping ingest:** `POST /race-rooms/:roomId/pings`, validation, in-memory history, docs ([ws2-task1-pings.md](../api/ws2-task1-pings.md)).
- **Task 2 — Projection:** activation `course` / pace, deterministic recompute, `GET /race-rooms/:roomId/projection`, docs ([ws2-task2-projection.md](../api/ws2-task2-projection.md)).
- **Task 3 — Confidence:** timeliness on projection reads and ping responses; env `PROJECTION_STALE_AFTER_SECONDS`; optional **`uploadIntervalSeconds`** with server-derived staleness threshold (see [ws2-task3-projection-confidence.md](../api/ws2-task3-projection-confidence.md) and [ws2-task3-projection-staleness.md](../api/ws2-task3-projection-staleness.md)).
- **Process:** GitHub issue + PR workflow documented ([github-issues-and-prs.md](./github-issues-and-prs.md)).

## Still in-memory

Race rooms, invites, pings, and projection state **reset on API restart**. Persistence and real auth are **out of scope** for this sprint; they remain the next **platform** slice after the demo proves the loop.

## Recommended next step (demo end-to-end)

**Ship a thin vertical slice in `apps/mobile`** that talks to the same API you already smoke-test:

1. **Config** — dev `API_BASE_URL` (e.g. machine IP + port 4000) and the same JWT shape the API expects (`sub`, `teamIds`, `roomRoles`).
2. **Athlete path** — create or join a paid **active** room (or use fixed IDs from a scripted setup), then **POST pings** on a timer with optional **`uploadIntervalSeconds`** (start with a single slider or two presets: “fast” / “slow”).
3. **Crew path** — **poll `GET .../projection`** every few seconds and render **`projectionConfidence`** (fresh vs degraded) plus at least one number from the payload (e.g. `progressMeters` or a single split row).

That gives a **credible demo loop** without Postgres. Follow with [mobile-athlete-ping-battery-deferred.md](./mobile-athlete-ping-battery-deferred.md) when you want real **battery modes** and race-length policy instead of manual intervals.

## Manual smoke (optional re-check)

Use the flows in the WS2 API docs (ping → GET projection; try silence past threshold; try `uploadIntervalSeconds` and confirm `stalenessThresholdSeconds` on the response).
