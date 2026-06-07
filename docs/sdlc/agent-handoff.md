# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-06-07 (UTC)
- **Roadmap phase:** Regression coverage automation / practical E2E crew chat hardening.
- **Branch:** `cursor/missing-test-coverage-d495`
- **Issue:** none created; automation environment exposes `gh` as read-only.
- **PR:** pending automation PR creation for this branch.
- **Acceptance criteria:** inspect recent merged code; add minimal high-signal regression tests for meaningful weak coverage; do not change production behavior; run relevant test targets.

## Completed (this session)

- Reviewed recent merged chat crypto/API work (#296, #298, #297, #289) and nearby tests for regression gaps.
- Added `roomKey` coverage proving a non-deterministic-distributor with stale local key returns `syncing` after server rotation, without uploading competing v2 envelopes or overwriting cached v1 material.
- Added API route coverage proving `GET /chat/rooms/:roomId/key-envelopes` returns only the caller's user-scoped key envelope when a room has envelopes for multiple members.
- Do-not-change guardrails honored: no production behavior changes, no API contract changes, no mobile UI changes, no staging/cloud behavior changes.

## Validation evidence

- `npm install` — pass; installed workspace dependencies from the existing lockfile so test runners were available.
- `npm run test -w @crewcue/chat-crypto` — pass (9 tests, including new non-distributor rotation regression).
- `npm run test:memory -w @crewcue/api` — pass (112 tests: 109 pass, 3 skipped, including new key-envelope caller-scoping regression).

## Next 1-3 tasks

1. Open the automation PR and confirm CI stays green.
2. Continue future coverage automation by checking recent production-only merges for permissions/parsing/idempotency gaps.
3. Optional hardening candidate: identity backup missing/undecryptable fallback semantics in `restoreIdentityWithBackup`.

## Open risks/blockers

- No GitHub issue was created because `gh` is read-only in this cloud run; PR should not use an auto-close issue line unless one is added later.
- Full `npm run verify` was not run; scoped targets cover the touched packages and route behavior.
- No iOS simulator run: no `apps/mobile/**` or mobile-visible behavior changed.

## Successor prompt

```text
On `cursor/missing-test-coverage-d495`, review/merge the regression coverage PR after CI: it adds chat-crypto non-distributor rotation coverage and API key-envelope caller-scoping coverage with scoped tests passing.
```
