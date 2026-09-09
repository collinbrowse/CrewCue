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
- **Roadmap phase:** Regression coverage automation over recent API race-condition fixes.
- **Branch / PR:** `cursor/missing-test-coverage-a2a7` → PR pending.
- **Active next:** Open coverage PR, then keep scanning recent merged production fixes for untested edge cases.

## Completed

- Added API regression coverage for PR #460's invite-cache hydrate race: a stale persisted pending invite cannot reopen an already accepted invite.
- Added a test-only helper that mirrors the live invite hydrate await/recheck path without changing production behavior.

## Next 1-3 tasks

1. Merge the coverage PR after CI is green.
2. Continue daily coverage scan for recent merged production-only bug fixes.
3. Revisit stale persisted member-list hydration after live membership removal if a behavior fix is needed before tests.

## Validation evidence

- `npm run build -w @crewcue/api && PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/routes/raceRooms.test.js`
- `npm run test:memory -w @crewcue/api`
- `npm run verify`

## Open risks/blockers

- GitHub issue was not created: this automation environment documents `gh` as read-only and exposes no issue-creation MCP tool.
- API-only coverage; no mobile UI or simulator validation required.

## Successor prompt

```text
Review and merge the invite hydrate coverage PR after CI passes. Then scan recent merged production fixes for the next highest-risk missing regression test, especially member-list hydration removal behavior.
```
