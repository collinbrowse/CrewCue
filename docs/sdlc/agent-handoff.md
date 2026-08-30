# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-30 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — post-W4 hardening and regression coverage.
- **Branch / PR:** `cursor/missing-test-coverage-2754` (PR pending).
- **Active next:** Review/merge Strava connection store coverage, then continue staging redeploy and smoke checks.

## Completed

- Added `services/api/src/lib/stravaConnectionStore.test.ts` to cover OAuth state scoping/single-use and per-athlete token isolation/public visibility.
- Confirmed recent open coverage PRs already own activity-history and Strava sync route gaps; this run avoided those paths.
- Root verification passed locally after restoring dependencies with `npm ci`.

## Next 1-3 tasks

1. Review and merge the Strava connection store coverage PR once CI is green.
2. Redeploy staging API.
3. Smoke Profile GPX upload → Open Pace; Strava reconnect.

## Validation evidence

- `PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/lib/stravaConnectionStore.test.js` — pass.
- `npm run test:memory -w @crewcue/api` — pass (285 pass, 4 skipped).
- `npm run verify` — pass.

## Open risks/blockers

- No issue could be created from this automation because the available GitHub CLI path is read-only and no issue-creation MCP tool is configured.
- Staging may still need Railway redeploy.

## Successor prompt

```text
Review/merge the Strava connection store coverage PR after CI. Then redeploy staging API and smoke GPX upload → Open Pace against staging.
```
