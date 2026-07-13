# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-13 (UTC)
- **Roadmap phase:** Regression-prevention coverage automation for practical E2E crew chat.
- **Branch:** `cursor/missing-test-coverage-fe14`
- **Issue:** none created; this automation environment has read-only `gh` guidance and no issue-creation MCP tool.
- **PR:** #318 — test(api): cover Stream channel member sync.
- **Acceptance criteria:** add deterministic high-signal tests for recent risky production code; avoid production behavior changes; validate the touched API test target.

## Completed (this session)

- Added `services/api/src/lib/streamChannelMembers.test.ts`.
- Covered Stream Chat room-channel member sync for duplicate/existing channel creation, full current-roster user upsert/add, stale Stream member removal, display-name trimming, and the empty-query guard that prevents accidental member removal when SDK state is not hydrated.
- Do-not-change guardrails honored: no production behavior changes, no API contract changes, no mobile UI changes, no staging/cloud config changes.

## Validation evidence

- Initial `npm run test:memory -w @crewcue/api` failed because dependencies were not installed (`tsc: not found`).
- `npm install` — pass; installed workspace dependencies, no intentional dependency changes.
- `npm run test:memory -w @crewcue/api` — pass (113 tests discovered; 110 passed, 3 skipped, 0 failed), including the new Stream channel member sync tests.

## Next 1-3 tasks

1. Confirm the automation PR CI is green after branch push.
2. Next coverage candidate: platform event duplicate-key mismatch semantics across aggregate/payload differences.
3. Next coverage candidate: Stream channel route-level 502 behavior if member sync fails while requesting a room-scoped token.

## Open risks/blockers

- No GitHub issue was created for this run because the available tools do not include issue creation and `gh` is read-only by environment instruction.
- No iOS simulator run: API-only test coverage changed, not mobile UI.
- Full `npm run verify` was not run; validation was scoped to the API memory test target for the touched service area.

## Successor prompt

```text
PR #318 on branch cursor/missing-test-coverage-fe14 adds Stream channel member sync regression tests and API memory tests pass. Confirm PR CI. For the next coverage automation run, prefer platform event duplicate-key mismatch semantics or route-level Stream sync failure behavior.
```
