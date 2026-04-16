# WS7 Execution Sequence (Sprint 1)

**Sprint status: complete** — see [ws7-sprint-signoff.md](./ws7-sprint-signoff.md).

This sprint establishes **canonical platform contracts**, a **versioned event envelope**, and an **append-only platform event log** with **idempotent append** and a **deterministic `race_room` replay reducer** — implemented **in-memory** in the API with HTTP surfaces, matching ADR 0003’s intent until PostgreSQL wiring ships.

**Sprint hub (GitHub):** [#57 — WS7 Sprint 1 tracking](https://github.com/collinbrowse/CrewCue/issues/57)  
**Milestone:** *WS7 Sprint 1 — platform contracts and event log*  
**Master plan (repo root):** [ws7-shared-platform-contracts-and-data-model-plan.md](../../ws7-shared-platform-contracts-and-data-model-plan.md)

## What WS7 adds (conceptually)

- A **single envelope** (`PlatformEventEnvelope`) for cross-workstream facts instead of ad-hoc JSON blobs.
- **Explicit schema batching** via `PLATFORM_SCHEMA_VERSION` and a written **compatibility policy** ([ws7-schema-compatibility.md](./ws7-schema-compatibility.md)).
- A **replayable** slice of the `race_room` aggregate so we can prove **deterministic reconstruction** before projection tables exist.

## Dependencies (and deferrals)

| Area | Sprint 1 stance |
| --- | --- |
| **PostgreSQL `domain_events` table** | **Deferred** — ADR 0003; in-memory store proves API + contracts. |
| **BLE transport** | **Represented** as `transport: "ble"` on the envelope only. |
| **Full reducer coverage** for every `PlatformEventName` | **Deferred** — only `race_room.*` + `plan_version.recorded` fold into `ReplayedRaceRoomAggregate` today. |

---

## Task 1: Execution sequence + compatibility docs

**GitHub:** [#52](https://github.com/collinbrowse/CrewCue/issues/52)

### Objective

This ladder plus [ws7-schema-compatibility.md](./ws7-schema-compatibility.md).

### Done when

- Docs merged under `docs/sdlc/`.

---

## Task 2: Shared contracts

**GitHub:** [#53](https://github.com/collinbrowse/CrewCue/issues/53)

### Objective

`PLATFORM_SCHEMA_VERSION`, `TransportChannel`, `PlatformEventEnvelope`, canonical entity graph types, and `ReplayedRaceRoomAggregate`.

### Done when

- Types exported from `packages/contracts` and compile across workspaces.

---

## Task 3: Event log library

**GitHub:** [#54](https://github.com/collinbrowse/CrewCue/issues/54)

### Objective

`appendPlatformEvent`, global idempotency, per-aggregate `sequence`, `reduceRaceRoomEvents`, and test-only reset.

### Done when

- Unit tests prove **idempotent append** and **order-insensitive replay** (sort by `sequence`).

---

## Task 4: HTTP API

**GitHub:** [#55](https://github.com/collinbrowse/CrewCue/issues/55)

### Objective

- `POST /platform/v1/events`
- `GET /platform/v1/events?aggregateType=race_room&aggregateId=...`
- `GET /platform/v1/aggregates/race_room/:aggregateId/replay`

### Done when

- Race room **membership** enforced; duplicate idempotency returns **200** with `duplicate: true`.

---

## Task 5: Sprint sign-off

**GitHub:** [#56](https://github.com/collinbrowse/CrewCue/issues/56)

### Objective

[ws7-sprint-signoff.md](./ws7-sprint-signoff.md) describing shipped vs deferred scope.

### Done when

- Doc merged.

---

## Order rationale

1. **Contracts + policy** — prevents silent drift.
2. **Library** — replay correctness without HTTP noise.
3. **HTTP** — operator and client integration path.

## Done definition for WS7 Sprint 1

- Issues **#52–#56** and hub **#57** closed via the delivery PR ([workflow](./github-issues-and-prs.md)).
- This doc, compatibility policy, and sign-off merged.
