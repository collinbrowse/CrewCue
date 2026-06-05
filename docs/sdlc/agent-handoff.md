# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-06-05 (UTC)
- **Branch:** `cursor/missing-test-coverage-3538`
- **Issue:** none provided for this scheduled coverage run
- **PR:** to be opened for chat-crypto backup restore coverage

## Completed (this session)

- Inspected recent merged changes and selected the new `@crewcue/chat-crypto` backup restore path from the practical E2E chat merge as the highest-risk coverage gap.
- Added regression coverage in `packages/chat-crypto/src/roomKey.test.ts` proving backup restore persists the restored identity and room key.
- Fixed `restoreIdentityWithBackup` in `packages/chat-crypto/src/roomKey.ts` so the API registers the restored public key after a valid backup, instead of a transient generated identity.

## Validation evidence

- Pre-fix `npm test -w @crewcue/chat-crypto` — failed on new backup restore registration assertion.
- Post-fix `npm test -w @crewcue/chat-crypto` — pass (6/6).
- `npm run build -w @crewcue/chat-crypto` — pass.
- `npm run verify` — pass.

## Next 1-3 tasks

1. Review/merge the coverage PR after GitHub Actions are green.
2. Continue scheduled coverage sweeps against recent merged code, prioritizing security/data recovery and authorization paths.
3. Consider adding API-level chat identity backup conflict tests if future persistence work changes backup semantics.

## Open risks/blockers

- No mobile UI files changed; iOS simulator proof was not required.
- This run did not create a GitHub issue because no issue was provided and this environment restricts GitHub CLI writes; the PR description should record the scheduled coverage scope.

## Successor prompt

```text
Coverage run on cursor/missing-test-coverage-3538 added chat-crypto backup restore regression coverage and fixed restored identity registration. Confirm PR CI green, then merge. Next sweep: inspect newest merged code for untested authz/data-validation/security paths.
```
