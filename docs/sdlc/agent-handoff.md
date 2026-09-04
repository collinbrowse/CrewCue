# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-04 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing hardening; daily test coverage automation.
- **Branch / PR:** `cursor/missing-test-coverage-8861` -> PR #467.
- **Active next:** Merge PR #467 after CI green.

## Completed

- Added API regression coverage for `GET /race-rooms/:roomId/schedule` when the projection loader has no snapshot yet.
- The new test locks the intended plan-only schedule fallback while adjacent coverage still asserts projection hydrate failures return 503.

## Next 1-3 tasks

1. Merge PR #467 after CI green.
2. Continue monitoring recent production merges for untested schedule/projection, Strava, and activity-history edges.
3. If a GitHub issue is created manually for this run, add `Closes #<issue>` to the PR before merge.

## Validation evidence

- `PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/routes/raceRoomSchedule.test.js` - pass.
- `npm run test:memory` - pass.
- `npm run verify` - pass.

## Open risks/blockers

- No issue was created: this automation environment has no issue-creation MCP tool and `gh` write operations are disallowed.
- No mobile UI changed; iOS simulator QA is N/A.

## Successor prompt

```text
Review and merge the schedule projection no-snapshot coverage PR after CI passes. If a manual issue exists, add Closes #<issue> to the PR body before merge.
```
