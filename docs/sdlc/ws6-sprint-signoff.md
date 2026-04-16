# WS6 Sprint 1 — sign-off

**Status:** Complete (HTTP **multi-athlete command board**, **metric selection**, **staffing overlaps**, and **checkpoint heatmap**; **in-memory** config and **stubbed** fueling metrics).

**Tracking:** [#50](https://github.com/collinbrowse/CrewCue/issues/50) · **Milestone:** [WS6 Sprint 1 — team command center](https://github.com/collinbrowse/CrewCue/milestone/4)

## What ships in Sprint 1

- **Contracts:** `TeamCommandBoard`, `AthleteStatusCard`, `TeamCommandMetricConfig`, `StaffingOverlap`, `CheckpointDemandHeatmap`, and related metric kinds (see `packages/contracts`).
- **API:** routes under `/teams/:teamId/command-center/...` for **board**, **metric-config** (`GET` + `PUT`), **staffing-overlaps**, and **checkpoint-heatmap** (see `services/api/src/routes/ws6CommandCenterRoutes.ts`).
- **Integration:** reuses WS2 stored projection timeliness, WS3 task board state, WS5 heartbeat roll-ups via small exports from `raceRooms` and `ws5SyncRoutes`.
- **Tests:** `raceRoomWs6.test.ts` covering happy paths and **403** authz boundaries.

## Explicitly not in Sprint 1

- Durable team/roster persistence and cross-tenant reporting (defer to **WS7**).
- Real calories/carbs/electrolyte/sodium telemetry streams (cells use **deterministic stubs** on active rooms only).
- Predictive staffing optimization beyond **visibility** signals.

## Suggested next step after merge

Add a **manager web** or **tablet** client that polls the board route on a short interval, renders **AthleteStatusCard** rows, and highlights **overlaps** + **heatmap** cells — then wire real nutrition inputs when those pipelines exist.
