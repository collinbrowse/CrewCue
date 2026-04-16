# WS6 Execution Sequence (Sprint 1)

**Sprint status: complete** — see [ws6-sprint-signoff.md](./ws6-sprint-signoff.md).

This sprint delivers a **visibility-first** slice of the **team command center**: managers and crew chiefs can **read a multi-athlete board** (projection + task + sync roll-ups), **configure which fueling metrics appear**, and retrieve **staffing overlap** plus **checkpoint demand heatmap** signals — all **HTTP + in-memory**, without predictive automation or durable team persistence yet.

**Sprint hub (GitHub):** [#50 — WS6 Sprint 1 tracking](https://github.com/collinbrowse/CrewCue/issues/50)  
**Milestone:** *WS6 Sprint 1 — team command center*  
**Master plan (repo root):** [ws6-team-command-center-and-multi-athlete-concurrency-plan.md](../../ws6-team-command-center-and-multi-athlete-concurrency-plan.md)

## What WS6 adds (conceptually)

- **WS2–WS5** optimize **one race room** at a time.
- **WS6** optimizes **one team’s concurrent operations**: *which athletes need attention, where crew capacity collides, and where checkpoint demand stacks up* — using the same live read models you already trust per room.

Sprint 1 focuses on **aggregate read APIs + metric selection** that clients can adopt before a full UI build-out. **Durable `Team` aggregates**, **real nutrition telemetry**, and **historical overlap analytics** stay aligned to **WS7** follow-ons.

## Dependencies (and deferrals)

| Area | Sprint 1 stance |
| --- | --- |
| **WS7** durable team boards / roster storage | **Deferred** — metric config is in-memory per API process. |
| **Live nutrition feeds** | **Deferred** — metric cells use deterministic **stubs** on active rooms so UI can bind to bands safely. |
| **WS5 BLE** | **Not required** — board uses the same WS5 heartbeat roll-up helper as the per-room health model. |

---

## Task 1: Execution sequence doc

**GitHub:** [#45](https://github.com/collinbrowse/CrewCue/issues/45)

### Objective

This ladder document plus links to the sprint hub and sign-off.

### Done when

- Doc merged under `docs/sdlc/`.

---

## Task 2: Shared contracts

**GitHub:** [#46](https://github.com/collinbrowse/CrewCue/issues/46)

### Objective

Stable DTOs for `TeamCommandBoard`, `AthleteStatusCard`, `TeamCommandMetricConfig`, `StaffingOverlap`, and `CheckpointDemandHeatmap`.

### Done when

- Types live in `packages/contracts` and compile everywhere they are imported.

---

## Task 3: Team command board aggregate read

**GitHub:** [#47](https://github.com/collinbrowse/CrewCue/issues/47)

### Objective

`GET /teams/:teamId/command-center/board` composes **per-room** WS2 projection (when present), WS3 task counts (manager lens), and WS5 sync summary for each **entitled** room the caller can operate.

### Done when

- **AuthZ:** caller must claim `teamId` in JWT `teamIds` and hold `team_manager` or `crew_chief` membership in at least one team room.
- Tests cover **403** for crew members and athletes without command-center roles.

---

## Task 4: Metric config + overlap + heatmap reads

**GitHub:** [#48](https://github.com/collinbrowse/CrewCue/issues/48)

### Objective

- `GET` / `PUT /teams/:teamId/command-center/metric-config` (PUT restricted to **team_manager**).
- `GET /teams/:teamId/command-center/staffing-overlaps` — same assignee `in_progress` across **two+** rooms.
- `GET /teams/:teamId/command-center/checkpoint-heatmap` — concurrent **pending / in_progress** demand per checkpoint across entitled rooms.

### Done when

- Tests cover **403** on metric `PUT` for `crew_chief`, and overlap detection across two active rooms.

---

## Task 5: Sprint sign-off doc

**GitHub:** [#49](https://github.com/collinbrowse/CrewCue/issues/49)

### Objective

Short shipped-scope / deferral note in [ws6-sprint-signoff.md](./ws6-sprint-signoff.md).

### Done when

- Doc merged.

---

## Order rationale

1. **Contracts** first — keeps payloads aligned across clients.
2. **Board aggregate** — proves the multi-room read path end-to-end.
3. **Config + overlap + heatmap** — adds the triage primitives from the WS6 plan without a heavy UI dependency.

## Done definition for WS6 Sprint 1

- Issues **#45–#49** and hub **#50** closed via the delivery PR ([workflow](./github-issues-and-prs.md)).
- This doc and [ws6-sprint-signoff.md](./ws6-sprint-signoff.md) merged.
