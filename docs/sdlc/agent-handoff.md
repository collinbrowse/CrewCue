# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-01 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-61eb` (base `main` @ `e0d1578`).
- **Active follow-up:** Critical bug fix — postgres hydrate-before-await wipe of WS2/WS4/WS5/WS6 runtime payloads.

## Completed

- Identified critical race: loaders marked rooms hydrated *before* DB read finished; concurrent GET projection / ping / sync could bootstrap empty state and persist over durable visits/projection (and same pattern on WS4/WS5/WS6).
- Fix: shared `createLazyHydrator` (single-flight + mark hydrated only after successful load); wired into raceRooms, ws4, ws5, ws6. Unit tests in `lazyHydrate.test.ts`.

## Next 1-3 tasks

1. Merge hydrate race fix PR; deploy staging API and smoke projection/visits after cold process restart under concurrent client traffic.
2. Staging deploy + signed-in chat smoke (prior handoff): migrate `0014_drop_chat_crypto.sql`; send + photo; peer read receipt.
3. Review open critical drafts #334–#338 (sign-out wipe, chat outbox, manual-stop, orphan create, course wipe-before-save).

## Open risks/blockers

- Open drafts #334–#338 still unmerged (separate data-loss / membership bugs).
- Auth0 still blocks unattended sim chat E2E.
- Join-by-code / `saveRaceRoom` memory-before-persist false success on retry remains deferred (pre-existing).
- Mobile sync outbox `replaceOutbox` can clobber concurrent enqueues (candidate for a later hunt).

## Successor prompt

```text
Hydrate race fix on cursor/critical-bug-investigation-61eb. Merge/deploy staging; cold-restart API and concurrent projection/ping smoke. Then triage open drafts #334–#338 or mobile outbox replace/enqueue race.
```
