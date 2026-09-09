# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-09 (UTC)
- **Roadmap phase:** Regression coverage automation over recent API room-hydration fixes.
- **Branch / PR:** `cursor/missing-test-coverage-a2a7` → PR #472.
- **Active next:** Review PR #472 after CI, then keep scanning recent merged production fixes for untested edge cases.

## Completed

- Added API regression coverage for PR #427/#460's list-hydrate race: a stale persisted room list cannot re-add a member after live removal.
- Left production behavior unchanged; the test uses the existing `ingestPersistedRaceRoomsWithoutClobberForTests` helper.

## Next 1-3 tasks

1. Merge PR #472 after CI is green.
2. Continue daily coverage scan for recent merged production-only bug fixes.
3. Avoid duplicating open PR #468's invite-hydrate coverage; retarget future runs to unclaimed gaps.

## Validation evidence

- `npm run build -w @crewcue/api && PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/routes/raceRooms.test.js`
- `npm run test:memory -w @crewcue/api`
- `npm run verify`

## Open risks/blockers

- GitHub issue was not created: this automation environment documents `gh` as read-only and exposes no issue-creation MCP tool.
- API-only coverage; no mobile UI or simulator validation required.

## Successor prompt

```text
Review PR #472 membership-removal hydrate coverage after CI passes. Then scan recent merged production fixes for the next unclaimed high-risk missing regression test; do not duplicate open PR #468 invite-hydrate coverage.
```
