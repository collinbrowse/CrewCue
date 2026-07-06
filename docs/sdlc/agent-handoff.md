# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-06 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / regression coverage automation.
- **Branch:** `cursor/missing-test-coverage-6460`
- **Issue:** none created; this environment has read-only `gh` guidance and no issue-creation MCP tool.
- **PR:** pending automation PR creation.
- **Acceptance criteria:** add deterministic high-signal tests for recent risky behavior; avoid production changes; run scoped validation.

## Completed (this session)

- Reviewed recent merged code for coverage gaps, prioritizing non-cosmetic production behavior.
- Added API authorization regression coverage for nonmembers attempting room-scoped chat reads, notification preference reads/writes, Stream channel sync, and diagnostics.
- Touched files: `services/api/src/routes/chatRoutes.test.ts` and this handoff doc only.
- Do-not-change guardrails honored: no production behavior changes, no API contract changes, no mobile UI changes, no staging/cloud rollout changes.

## Validation evidence

- Initial `npm run test:memory -w @crewcue/api` was blocked by missing dependencies (`tsc: not found`).
- `npm ci` — pass; installed locked dependencies, no manifest changes.
- `npm run test:memory -w @crewcue/api` — pass (112 tests, 109 pass, 3 skipped, 0 failed).

## Next 1-3 tasks

1. Confirm PR CI is green after automation opens the PR.
2. Next coverage candidate: chat crypto non-distributor `syncing` and solo `catastrophic_rekey` branches.
3. Separate coverage candidate: API idempotency partial-failure/retry edges.

## Open risks/blockers

- No linked GitHub issue exists because issue creation is unavailable in this automation environment.
- Full `npm run verify` was not run; scoped API memory suite covered the touched test area.
- No iOS simulator run: API test-only change, no mobile UI/mobile-visible behavior changed.

## Successor prompt

```text
On branch cursor/missing-test-coverage-6460, continue regression coverage automation after the API nonmember chat route tests. Confirm PR CI green; next high-value candidates are chat-crypto non-distributor/solo rotation branches or API idempotency retry partial-failure edges.
```
