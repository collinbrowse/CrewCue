# Agent handoff source of truth

Use this as the minimal continuity file between sessions.

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `docs/sdlc/mvp-ui-development-spec.md`
5. `docs/sdlc/ui-delivery-roadmap-and-spec.md`
6. `.cursor/rules/github-pr-issue-workflow.mdc`
7. `.github/pull_request_template.md`

## Session status snapshot

- Last updated: 2026-05-06 (America/Chicago)
- **Active issue:** [#224](https://github.com/collinbrowse/CrewCue/issues/224)
- **Active branch:** `feature/224-tmr-aid-station-parser-tests`

## Current objective

Deliver regression coverage for TMR 100K JSON aid-station parsing so waypoint extraction, ordering, duplicate encounters, and start/finish anchors stay stable.

## Acceptance criteria (issue #224)

1. Check in real TMR 100K JSON as a stable map-core test fixture.
2. Add regression test asserting screenshot-truth checkpoint sequence with duplicate Bridal Veil encounter.
3. Ensure tests cover start-first/finish-last anchoring and deterministic ordering by route progress.
4. Preserve parser behavior for duplicate checkpoint IDs via suffixing.
5. Run `npm test --workspace @crewcue/map-core` and `npm run verify` successfully.

## Delivered (feature/224-tmr-aid-station-parser-tests)

- `packages/map-core/src/__fixtures__/2026_TMR_100k_AidStations.json`: added real-race fixture with one LineString and point aid-station markers.
- `packages/map-core/src/courseParse.test.ts`: added fixture-backed regression tests covering:
  - expected TMR checkpoint order matching screenshot truth;
  - start-first / finish-last anchoring and duplicate Bridal Veil encounter;
  - deterministic ordering by route progress even when source point features are reversed.
- Parser code required no changes; current behavior already satisfies fixture-based expectations.

## Next 1-3 tasks

1. Monitor import UX expectations around `Town Park Start/ Finish` being represented as `town-park-start-finish` and `town-park-start-finish-2` (single source marker, dual encounter expansion).
2. If product wants distinct semantic labels for start vs finish IDs, add a follow-up parser normalization test and implementation.
3. Merge PR for issue #224 after review and green checks.

## Validation summary

- `npm test --workspace @crewcue/map-core` ✅
- `npm run verify` ✅

## Open risks/blockers/questions

- TMR source file uses a single `Town Park Start/ Finish` marker; parser emits first and last checkpoints from repeated encounters with numeric suffix on the final one.
- Screenshot text says `Finish Line (Town Park)` while fixture marker title is `Town Park Start/ Finish`; if naming parity is required, parser naming rules need explicit transformation.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Do not commit real MapTiler/OSRM secrets.

## Successor prompt

```text
Continue #224 on branch feature/224-tmr-aid-station-parser-tests. If review requests stricter start/finish naming semantics for the TMR fixture, add a dedicated normalization rule and targeted tests without changing checkpoint progress ordering. Re-run npm test --workspace @crewcue/map-core and npm run verify, then update PR.
```
