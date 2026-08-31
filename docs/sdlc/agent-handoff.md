# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-31 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — regression coverage automation.
- **Branch / PR:** `cursor/missing-test-coverage-530d` → coverage PR to open (no issue created: automation has read-only `gh` and no issue MCP tool).
- **Active next:** Review/merge coverage PR after CI green; redeploy staging; soak Strava/Profile pacing flows.

## Completed

- #427: list rooms no longer clobbers live room cache.
- #426: cutoff warning regression coverage.
- #428: pacing estimator validation edges.
- CI: `checks` job now runs on `main` push (was skipped when PR-only guard skipped).
- Added Strava OAuth callback coverage for missing redirect `scope` falling back to weak token-response scope, proving the weak grant is rejected and not persisted.

## Next 1-3 tasks

1. Review/merge current Strava scope fallback coverage PR after CI green.
2. Redeploy staging API.
3. Smoke Profile GPX upload → Open Pace; Strava reconnect.

## Validation evidence

- `npm run test:memory -w @crewcue/api` — pass (288 tests, 284 pass, 4 skipped).
- `npm run verify` — pass.

## Open risks/blockers

- Staging may still need Railway redeploy.
- GitHub issue creation remains unavailable from this automation environment; link one manually before merge if required.

## Successor prompt

```text
Review current coverage PR: it adds `services/api/src/routes/stravaRoutes.test.ts` coverage for missing redirect scope falling back to weak token response scope. Ensure CI green, then redeploy staging and smoke GPX upload → Open Pace plus Strava reconnect.
```
