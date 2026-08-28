# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-28 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — regression coverage pass after Strava/GPX merges.
- **Branch / PR:** `cursor/missing-test-coverage-cf20` / PR #459.
- **Active next:** Open coverage PR, confirm CI green, then continue staging redeploy/smoke queue.

## Completed

- Added API route coverage for mixed GPX files so planned `<rte>` distance cannot inflate recorded `<trk>` activity metrics.
- Added API route coverage for Strava activity-list 403 failures so `/strava/sync` returns `strava_activities_http` and creates no history rows.

## Next 1-3 tasks

1. Confirm PR CI green (`checks`, `dual-client-guard`, `api-postgres-integration`).
2. Redeploy staging API.
3. Smoke Profile GPX upload → Open Pace; Strava reconnect.

## Validation evidence

- Focused: `npm run build -w @crewcue/api && PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/routes/activityHistory.test.js services/api/dist/services/api/src/routes/stravaRoutes.test.js` (22/22 pass).
- Full: `npm run verify` (pass).

## Open risks/blockers

- No GitHub issue created: this automation environment has read-only `gh` guidance and no issue-creation MCP tool.
- Staging may still need Railway redeploy.

## Successor prompt

```text
Confirm the coverage PR CI is green, then redeploy staging API and smoke GPX upload → Open Pace plus Strava reconnect.
```
