# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-14 (UTC)
- **Roadmap phase:** Regression coverage automation / practical E2E crew chat hardening.
- **Branch:** `cursor/missing-test-coverage-40e8`
- **Issue:** none created; this automation has read-only `gh` guidance and no issue-creation MCP tool.
- **PR:** #319 — test(api): cover Stream sync failure on room-scoped chat token.
- **Acceptance criteria:** inspect recent merged code, add minimal high-signal regression tests, avoid production behavior changes, run relevant tests plus local parity verification.

## Completed (this session)

- Reviewed recent merged changes and prior automation memory; skipped already-covered chat crypto/idempotency and cosmetic/mobile-only changes.
- Added API route regression coverage for `/chat/stream-token` with `roomId` returning 502 when server-side Stream channel membership sync fails.
- Changed file: `services/api/src/routes/chatRoutes.test.ts`.
- Do-not-change guardrails honored: no production behavior changes, no contracts changes, no mobile UI changes, no real Stream SDK/network dependency in tests.

## Validation evidence

- Initial `npm run test:memory -w @crewcue/api` failed before tests because dependencies were not installed (`tsc: not found`).
- `npm install` — completed from existing lockfile/workspace configuration.
- `npm run test:memory -w @crewcue/api` — pass (112 tests, 109 pass, 3 skipped).
- `npm run typecheck -w @crewcue/api` — pass.
- `npm run verify` — pass.

## Next 1-3 tasks

1. Confirm PR #319 CI stays green.
2. Future coverage candidate: platform event duplicate-key mismatch semantics across aggregate/payload differences.
3. Future coverage candidate: API idempotency partial-failure/retry edges not already covered by stale-lease tests.

## Open risks/blockers

- No linked GitHub issue was created because this automation cannot perform issue writes in the current environment.
- No iOS simulator run: API-only test coverage change, no mobile UI-visible behavior changed.

## Successor prompt

```text
Continue PR work on cursor/missing-test-coverage-40e8. The branch adds API regression coverage for room-scoped /chat/stream-token returning 502 when Stream channel membership sync fails. Verify CI and consider future coverage for platform event duplicate-key mismatch semantics or API idempotency partial failures.
```
