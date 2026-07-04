# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-04 (UTC)
- **Roadmap phase:** Regression coverage automation / chat crypto hardening.
- **Branch:** `cursor/missing-test-coverage-b839`
- **Issue:** none created; this cron automation has read-only `gh` guidance.
- **PR:** pending automation PR creation after final push.
- **Acceptance criteria:** inspect recent merged production code; add minimal deterministic tests for meaningful uncovered risk; avoid production behavior changes; run relevant tests and local parity verification.

## Completed (this session)

- Added chat-crypto coverage for the non-distributor branch after server room-key rotation.
- The new test proves a member with stale cached room-key material returns `syncing`, uploads no stale/conflicting envelopes, and preserves its local stale key until the deterministic distributor publishes the current version.
- Changed files: `packages/chat-crypto/src/roomKey.test.ts` and this handoff only.
- Do-not-change guardrails honored: no production behavior changes, no API contract changes, no mobile UI changes, no staging/cloud rollout changes.

## Validation evidence

- `npm ci` — pass; installed pinned workspace dependencies, with existing npm audit warnings reported.
- `npm run test -w @crewcue/chat-crypto` — pass (9 tests).
- `npm run typecheck -w @crewcue/chat-crypto` — pass.
- `npm run verify` — pass.

## Next 1-3 tasks

1. Open/update the PR for `cursor/missing-test-coverage-b839` and confirm CI stays green.
2. In a future coverage run, inspect API idempotency partial-failure/retry paths for missing edge-case tests.
3. In a future coverage run, revisit identity backup restore-before-register semantics if recent production changes touch that area.

## Open risks/blockers

- No GitHub issue was created because this automation is constrained to read-only `gh`; PR body should note `Closes #` is not available.
- No iOS simulator run: package-only test coverage changed, not mobile UI or mobile-visible behavior.
- Existing dependency audit warnings remain from the lockfile; no dependencies were changed.

## Successor prompt

```text
On branch cursor/missing-test-coverage-b839, confirm PR CI for the chat-crypto regression coverage added in packages/chat-crypto/src/roomKey.test.ts. If continuing coverage automation, target API idempotency retry/partial-failure edges next; avoid mobile UI unless simulator validation is planned.
```
