# WS5 Execution Sequence (Sprint 1)

**Sprint status: complete** — see [ws5-sprint-signoff.md](./ws5-sprint-signoff.md).

This sprint delivers an **HTTP-first** slice of **connectivity resilience and sync health**: devices can **report heartbeats and queue shape**, operators can **read freshness and pending pressure**, and clients can emit **merge decision telemetry** — without claiming BLE mesh or full WS7 merge semantics yet.

**Sprint hub (GitHub):** [#43 — WS5 Sprint 1 tracking](https://github.com/collinbrowse/CrewCue/issues/43)  
**Milestone:** *WS5 Sprint 1 — connectivity and sync health*  
**Master plan (repo root):** [ws5-connectivity-resilience-and-sync-health-plan.md](../../ws5-connectivity-resilience-and-sync-health-plan.md)

## What WS5 adds (conceptually)

- **WS2–WS4** assume reasonably fresh clients talking to the API.
- **WS5** makes **sync confidence explicit**: *who is stale, how much is queued, and what merge decisions were taken on the ground* — so operators do not confuse “quiet UI” with “healthy sync.”

Sprint 1 focuses on **observability + telemetry APIs** that mobile/web can adopt immediately. **BLE peer sync**, **deterministic offline replay**, and **canonical merge** remain aligned to **WS7 / WS0** follow-ons.

## Dependencies (and deferrals)

| Area | Sprint 1 stance |
| --- | --- |
| **WS7** event-log-first merge | **Deferred** — `MergeRecord` is append-only telemetry here, not authoritative state machine. |
| **WS0** device security / messaging primitives | **Deferred** — heartbeats trust authenticated `sub`; tighten device binding later. |
| **BLE** peer discovery / transfer | **Deferred** — not implemented server-side in Sprint 1; clients may still use BLE locally and report outcomes via these HTTP surfaces. |

---

## Task 1: Shared contracts

**GitHub:** [#39](https://github.com/collinbrowse/CrewCue/issues/39)

### Objective

Stable DTOs for queue diagnostics, device heartbeats, aggregated sync status, and merge telemetry.

### Done when

- Types live in `packages/contracts` and compile everywhere they are imported.

---

## Task 2: Device heartbeat + sync health read

**GitHub:** [#40](https://github.com/collinbrowse/CrewCue/issues/40)

### Objective

`POST` heartbeat updates per `(room, user, device)` and `GET` a **computed** `SyncStatus` with `isStale` per device using a configurable threshold.

### Done when

- Tests cover membership/entitlement and basic stale transition with a short wall-clock wait (small `setTimeout` in test).

---

## Task 3: Queue diagnostics ingest + list

**GitHub:** [#41](https://github.com/collinbrowse/CrewCue/issues/41)

### Objective

Clients POST summarized `pendingByOpType` counts; operators `GET` recent diagnostics for a room (bounded list).

### Done when

- Cap enforced; authz matches other race room reads/writes.

---

## Task 4: Merge decision telemetry

**GitHub:** [#42](https://github.com/collinbrowse/CrewCue/issues/42)

### Objective

Append-only `MergeRecord` capture for conflict keys and strategy labels (telemetry path ahead of WS7 merge engine).

### Done when

- POST + GET with membership + entitlement checks; tests for forbidden access.

---

## Order rationale

1. **Contracts** first — keeps payloads consistent across clients.
2. **Heartbeat + health** — establishes freshness semantics everything else hangs on.
3. **Queue diagnostics** — adds operator-visible pressure signals.
4. **Merge telemetry** — cheapest audit trail that still proves the reporting loop.

## Done definition for WS5 Sprint 1

- Issues **#38–#42** and hub **#43** closed via the delivery PR ([workflow](./github-issues-and-prs.md)).
- This doc and [ws5-sprint-signoff.md](./ws5-sprint-signoff.md) merged.
