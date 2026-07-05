# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-05 (UTC)
- **Roadmap phase:** Regression coverage automation / API retry hardening.
- **Branch:** `cursor/missing-test-coverage-0005`
- **Issue:** none created; automation environment has read-only `gh` and no issue-creation MCP tool.
- **PR:** #307 — test(api): cover course update idempotency recovery.
- **Acceptance criteria:** inspect recent merged work; add meaningful missing tests only; keep production behavior unchanged; run relevant tests and repo verify.

## Completed (this session)

- Reviewed recent merged PRs and prior automation memory; skipped already-covered chat-crypto regressions from PRs #296-#298.
- Added route-level coverage for `PUT /race-rooms/:roomId/course` idempotency in `services/api/src/routes/raceRooms.test.ts`.
- New test proves a failed in-handler course save releases the idempotency key, then a corrected retry with the same key succeeds and subsequent identical retry replays the cached response.
- Do-not-change guardrails honored: no production code changes, no API contract changes, no mobile UI/simulator scope, no cloud/staging rollout changes.

## Validation evidence

- `npm run test:memory -w @crewcue/api` — pass (112 tests; 108 pass, 3 skipped).
- `npm run verify` — pass.

## Next 1-3 tasks

1. Monitor PR #307 CI and merge when checks are green.
2. Future coverage candidate: chat backup behavior when local backup secret cannot decrypt an existing server backup.
3. Future coverage candidate: stale processing lease recovery in the memory HTTP idempotency store.

## Open risks/blockers

- No GitHub issue was created because available tooling for this automation run cannot create issues.
- No iOS simulator run: API route test-only change, no mobile UI-visible behavior changed.

## Successor prompt

```text
Continue from PR #307 on cursor/missing-test-coverage-0005. The only code change is API route test coverage for course PUT idempotency recovery/replay; local `npm run test:memory -w @crewcue/api` and `npm run verify` passed. Monitor CI and consider next coverage targets: undecryptable chat backup overwrite and stale memory idempotency processing leases.
```
