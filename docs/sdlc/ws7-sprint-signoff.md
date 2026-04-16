# WS7 Sprint 1 — sign-off

**Status:** Complete (**canonical contracts**, **schema versioning policy**, **append-only platform event log** with **idempotent append**, **deterministic `race_room` replay**; **in-memory** persistence in the API process).

**Tracking:** [#57](https://github.com/collinbrowse/CrewCue/issues/57) · **Milestone:** [WS7 Sprint 1 — platform contracts and event log](https://github.com/collinbrowse/CrewCue/milestone/5)

## What ships in Sprint 1

- **Contracts:** `PLATFORM_SCHEMA_VERSION`, `PlatformEventEnvelope`, `TransportChannel`, canonical entity graph types (`PlatformTeam`, `PlatformAthlete`, …), `ReplayedRaceRoomAggregate`, and a cross-workstream `PlatformEventName` catalog (see `packages/contracts`).
- **Library:** `services/api/src/lib/platformEventLog.ts` — idempotent append, per-aggregate sequencing, `reduceRaceRoomEvents` / `replayRaceRoomAggregate`.
- **API:** `/platform/v1/events` (`POST`, `GET`) and `/platform/v1/aggregates/race_room/:aggregateId/replay` with **race room membership** gates (see `ws7PlatformRoutes.ts`).
- **Docs:** this sign-off, [ws7-execution-sequence.md](./ws7-execution-sequence.md), and [ws7-schema-compatibility.md](./ws7-schema-compatibility.md).
- **Tests:** `platformEventLog.test.ts`, `ws7Platform.test.ts`.

## Explicitly not in Sprint 1

- PostgreSQL `domain_events` persistence and projection rebuild jobs (ADR 0003 implementation).
- Reducer coverage for every catalogued `PlatformEventName` (only the `race_room` slice + `plan_version.recorded` folds today).
- Non–`race_room` aggregates on the HTTP surface (return **400** until registration work lands).

## Suggested next step after merge

Create the **`domain_events`** table and migrate `appendPlatformEvent` to a transactional write path, keeping the **same envelope** shape so replay tooling stays stable.
