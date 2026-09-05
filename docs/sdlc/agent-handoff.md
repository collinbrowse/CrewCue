# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-05 (UTC)
- **Roadmap phase:** Test coverage automation follow-up on recent API race-room cache bug fixes.
- **Branch / PR:** `cursor/missing-test-coverage-8c7a` -> PR pending.
- **Active issue:** None created; this automation environment has read-only `gh` guidance and no issue-creation MCP tool.
- **Acceptance criteria:** add focused deterministic tests for recent high-risk merged code without changing product behavior; run touched-area tests and root verify.

## Completed

- Added API regression coverage for stale persisted invite hydrate snapshots so they cannot reopen an already accepted race-room invite.
- Refactored invite cache hydration through `rememberRaceRoomInviteIfAbsent`, mirroring the existing room hydrate helper and preserving live accepted invite state.

## Next 1-3 tasks

1. Merge the invite hydrate coverage PR after CI is green.
2. Continue coverage triage on future production-only bug fixes with API route/state races first.
3. Revisit any remaining Strava/activity-history edge cases only if new code lands without tests.

## Validation evidence

- `npm run build -w @crewcue/api && PERSISTENCE_MODE=memory node --test /workspace/services/api/dist/services/api/src/routes/raceRooms.test.js` - pass.
- `npm run test:memory -w @crewcue/api` - pass (301 pass, 4 skipped).
- `npm run verify` - pass.

## Open risks/blockers

- GitHub issue auto-close is not wired for this automation run because issue creation is unavailable in the configured toolset.
- `npm ci` reported pre-existing dependency audit findings; no dependency changes were made.

## Successor prompt

```text
Review recent merged production-only PRs after invite hydrate coverage, prioritize API cache/persistence race edges, add one focused deterministic test, then run npm run verify.
```
