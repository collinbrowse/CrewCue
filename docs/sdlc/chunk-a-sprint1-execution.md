# Chunk A Sprint 1 — execution sequence (WS1 durable persistence)

**Sprint hub (GitHub):** [#60](https://github.com/collinbrowse/CrewCue/issues/60)  
**Milestone:** *Chunk A Sprint 1 — WS1 durable persistence*  
**Strategy source:** [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md)

This sprint is the first **durability** slice after WS1–WS7 API foundations: migrate WS1 race-room and invite state from process memory to a Postgres-backed repository while preserving existing HTTP contracts.

## Scope

- Postgres-backed persistence for WS1 room and invite records (`PERSISTENCE_MODE=postgres` + `DATABASE_URL`).
- In-memory fallback mode (`PERSISTENCE_MODE=memory`) for local/dev fast cycles.
- No endpoint contract changes for `/race-rooms` and invite/entitlement/activation flows.
- Staging runbook for enabling real infra deploys and verifying restart-safe behavior.

## Task map

- **#61** — durable WS1 room + invite persistence implementation.
- **#62** — staging migration/runbook documentation for WS1 persistence.

## Implementation order

1. **Repository layer**: add persistence helpers (`load`/`persist`) and async retrieval on misses.
2. **Route integration**: wire `raceRooms.ts` WS1 mutations to persist-on-write.
3. **Cross-route compatibility**: update WS4/WS5/WS6/WS7 consumers to async room lookups.
4. **Operational docs**: add setup and verification steps for staged DB-backed behavior.

## Done definition

- API restart on staging does not lose WS1 room/invite state when `PERSISTENCE_MODE=postgres` and `DATABASE_URL` are configured.
- Existing API tests pass without requiring a local Postgres instance.
- Docs explain exactly how to enable and validate real infrastructure-backed deploys.
