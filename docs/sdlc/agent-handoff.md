# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-06-06 (UTC)
- **Roadmap phase:** Scheduled regression coverage for practical E2E crew chat hardening.
- **Branch:** `cursor/missing-test-coverage-6968`
- **Issue:** none created; this environment has read-only GitHub CLI access and no issue creation tool.
- **PR:** pending for this branch.
- **Acceptance criteria:** inspect recent merged risky code, add focused deterministic tests only, avoid production behavior changes, run relevant tests plus local parity verification.

## Completed (this session)

- Reviewed recent merged PRs #296, #297, and #298; selected chat-crypto server-rotation behavior as the highest-signal remaining weak coverage.
- Added a regression test proving a non-deterministic member with stale cached room-key material returns `syncing` and uploads no competing envelopes after server-side rotation.
- Kept changes test-only in `packages/chat-crypto/src/roomKey.test.ts`; no API, contract, mobile UI, or production crypto behavior changed.
- Installed locked dependencies with `npm ci` because the clean environment initially lacked `tsx`/`tsc`.

## Validation evidence

- `npm run test -w @crewcue/chat-crypto` — pass (9 tests; new non-distributor stale-key test is `ok 8`).
- `npm run typecheck -w @crewcue/chat-crypto` — pass.
- `npm run verify` — pass (lint, typecheck, tests, smoke, workspace builds including Expo export).

## Next 1-3 tasks

1. Confirm PR CI remains green after remote checks complete.
2. Continue future coverage automation on API idempotency partial-failure/retry paths.
3. Consider direct identity utility coverage for room-key index cleanup if future changes touch backup indexing.

## Open risks/blockers

- No linked issue exists for this scheduled automation run due GitHub write restrictions in this environment.
- No iOS simulator run: package-level test-only crypto coverage, no mobile-visible UI behavior changed.

## Successor prompt

```text
On branch cursor/missing-test-coverage-6968, PR pending: test-only chat-crypto coverage now asserts stale cached room keys do not rotate from non-deterministic members after server rotation. Verify CI, then merge if green. Next coverage target: API idempotency partial-failure/retry paths.
```
