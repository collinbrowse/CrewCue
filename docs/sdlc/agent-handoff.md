# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-08 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing; Strava activity-history coverage hardening.
- **Branch / PR:** `cursor/missing-test-coverage-cab6` → PR pending.
- **Active next:** Open/merge coverage PR after CI; then continue daily recent-merge coverage review.

## Completed

- Added API Strava unit coverage for `moving_time` fallback when `elapsed_time` is absent.
- Added Strava activity pagination safety-cap coverage when every page is full.

## Next 1-3 tasks

1. Merge the Strava coverage PR after CI is green.
2. Continue daily coverage review of newly merged production changes.
3. If GitHub write tooling becomes available, create issues before implementation per workflow.

## Validation evidence

- `npm run build -w @crewcue/api`
- `PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/lib/strava/mapStravaActivity.test.js services/api/dist/services/api/src/lib/strava/stravaClient.test.js`
- `npm run test:memory -w @crewcue/api`
- `npm run verify`

## Open risks/blockers

- GitHub issue creation is unavailable in this automation environment (`gh` is read-only; no issue MCP tool).
- `npm ci` reports existing dependency audit warnings; no dependencies were changed.

## Successor prompt

```text
Review/merge the Strava coverage PR. Next daily run should inspect new merged production changes and add only high-signal missing tests.
```
