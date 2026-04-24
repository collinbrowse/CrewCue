# Chunk A — WS1 durable persistence spec

**Audience:** engineers and operators implementing or reviewing Chunk A persistence work.  
**Strategy:** [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md) (Chunk A).  
**Related:** [chunk-a-sprint1-execution.md](./chunk-a-sprint1-execution.md) · [ADR 0003](../adr/0003-canonical-data-and-event-log.md)

## 1. Goal

Make WS1 room and invite state survive API restarts on staging without changing the existing HTTP contracts.

This is the first persistence bridge after WS1-WS7 foundations. It is intentionally pragmatic:

- keep the current API shape stable
- support `PERSISTENCE_MODE=memory` for fast local work
- support `PERSISTENCE_MODE=postgres` for restart-safe staging behavior
- establish an ADR 0003-compatible path toward event-log-first persistence

## 2. Scope

### In scope

- durable storage for `RaceRoom` records
- durable storage for `RaceRoomInvite` records
- persisted payload storage for room-linked runtime slices already used by later workstreams
- persisted aggregate/event tables needed by WS7 replay/snapshot flows
- health and startup behavior that clearly reports the active persistence mode

### Out of scope

- full normalization of room/invite data into relational tables
- replacing every JSON payload table with fully typed relational tables
- removing memory mode from local development
- production rollout policy beyond staging-first verification

## 3. Current persistence model

`services/api/src/lib/roomPersistence.ts` is the active persistence boundary.

It supports two modes:


| Mode       | Behavior                                                                |
| ---------- | ----------------------------------------------------------------------- |
| `memory`   | Existing in-process behavior. Fast local iteration, no restart safety.  |
| `postgres` | Reads/writes to Postgres-backed JSONB tables and event/snapshot tables. |


The current Chunk A implementation is a **bridge design**, not the final data model from ADR 0003:

- WS1 room and invite state is persisted as **whole JSON payloads**
- later workstream runtime payloads are also stored as JSONB blobs
- platform events and snapshots already have dedicated Postgres tables

That bridge is acceptable for Chunk A because it gives restart safety now while preserving a path to future event-first rebuilds.

## 4. Persistence surfaces

### WS1 canonical room/invite state


| Table                    | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `race_rooms_json`        | current `RaceRoom` payload keyed by room id |
| `race_room_invites_json` | invite payload keyed by token               |


### Runtime payload tables already supported by the persistence layer


| Table                              | Purpose                                   |
| ---------------------------------- | ----------------------------------------- |
| `room_task_boards_json`            | current task board payload for a room     |
| `room_ws2_runtime_json`            | WS2 runtime/projection payloads           |
| `room_ws4_adaptive_json`           | WS4 adaptive planning payloads            |
| `room_ws5_sync_json`               | WS5 sync heartbeat/health payloads        |
| `team_command_metric_configs_json` | team-level command metric config payloads |


### Event/snapshot tables aligned with ADR 0003


| Table                      | Purpose                                                  |
| -------------------------- | -------------------------------------------------------- |
| `platform_aggregate_heads` | last sequence per aggregate                              |
| `platform_domain_events`   | append-only persisted domain events with idempotency key |
| `race_room_snapshots`      | replay snapshot for race room aggregate                  |
| `task_board_snapshots`     | replay snapshot for task board aggregate                 |


## 5. Behavioral requirements

### Startup

- API startup must fail fast if `PERSISTENCE_MODE=postgres` and `DATABASE_URL` is missing
- API startup must initialize required tables before normal traffic
- startup logs must record the active persistence mode (`room_persistence_ready`)

### Health endpoints

Both:

- `GET /health/live`
- `GET /health/ready`

must return:

- `persistence.mode`
- `persistence.enabled`

This is the operator-facing truth source for whether the service is actually running against Postgres.

### Write path

WS1 mutations must continue to:

1. update the in-process aggregate/runtime state needed by the current server design
2. persist the resulting room/invite state when Postgres mode is enabled

### Read path

When a requested room or invite is not in memory, the API must be able to load it from Postgres and continue processing.

This is the key restart-safety behavior for Chunk A.

## 6. Acceptance criteria

Chunk A persistence is acceptable when all of the following are true:

1. A room created with `PERSISTENCE_MODE=postgres` is still retrievable after the API process restarts.
2. Invite acceptance and WS1 entitlement/activation paths continue to work after restart.
3. Local development can still run with `PERSISTENCE_MODE=memory` and no Postgres dependency.
4. Postgres-backed runs expose the expected persistence state in `/health/live` and `/health/ready`.
5. CI continues to cover both memory-first and Postgres-backed behavior.

## 7. Non-negotiable operator rules

- **Staging is the first truth environment.** Do not treat local Postgres as sufficient sign-off.
- **One active write spine per bounded context.** Do not add new memory-only authorities for room state after Chunk A.
- **Schema changes must be idempotent.** Re-running setup/migration steps must be safe.
- **Use the service's real `DATABASE_URL`.** Do not document localhost-only assumptions for staging.

## 8. Follow-on work after this spec

This spec does not claim Chunk A is the final persistence architecture. It defines the bridge needed now.

Expected later follow-ons:

- migrate more route groups from ad hoc in-memory runtime state toward persisted/evented sources
- add explicit rebuild/replay SOPs per aggregate
- progressively replace JSON blob tables where pilot evidence or query complexity justifies relational decomposition