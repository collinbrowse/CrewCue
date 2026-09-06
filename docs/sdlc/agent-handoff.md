# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-06 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing stabilization; regression coverage automation.
- **Branch / PR:** `cursor/missing-test-coverage-strava-pagination-cap` → PR pending.
- **Active next:** Merge this coverage PR after CI; continue the next daily sweep for production-only fixes without targeted tests.

## Completed

- Added Strava activity sync pagination coverage for the safety page cap when every Strava page is full.

## Next 1-3 tasks

1. Merge `cursor/missing-test-coverage-strava-pagination-cap` after CI green.
2. Continue coverage automation against recent API sync/idempotency and pacing estimate edges.
3. Revisit issue creation workflow if a write-capable issue tool becomes available.

## Validation evidence

- `npm run build -w @crewcue/api && node --test services/api/dist/services/api/src/lib/strava/stravaClient.test.js` passed.
- `npm run test:memory -w @crewcue/api` passed.
- `npm run verify` passed.

## Open risks/blockers

- No pre-filed GitHub issue: this automation environment has read-only `gh` guidance and no issue-creation MCP tool.
- Existing dependency audit findings remain from `npm ci`; not introduced by this test-only change.

## Successor prompt

```text
Review and merge the Strava pagination-cap coverage PR after CI. Next coverage sweep: inspect recent production-only API sync/idempotency changes and add one focused deterministic regression test where risk is highest.
```
