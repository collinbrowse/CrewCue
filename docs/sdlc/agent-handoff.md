# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-11 (UTC)
- **Roadmap phase:** Regression coverage automation / API idempotency hardening.
- **Branch:** `cursor/missing-test-coverage-fd9e`
- **Issue:** none created; this automation environment has read-only `gh` and no issue-creation MCP tool.
- **PR:** pending.
- **Acceptance criteria:** inspect recent merged code, add deterministic high-signal tests for meaningful regression risk, avoid production behavior changes, run relevant validation, commit/push, open PR.

## Completed (this session)

- Inspected recent merged PRs; chat crypto regressions were already covered by recent runs, while course/manual-stop route idempotency remained weak at the business-route boundary.
- Added `services/api/src/routes/raceRooms.test.ts` coverage for `PUT /race-rooms/:id/course` idempotency:
  - failed route-level save releases the claim so a corrected retry can proceed;
  - completed retry replays the cached response;
  - same key with a different completed body returns conflict.
- Do-not-change guardrails honored: no production behavior changes, no API contract changes, no mobile UI/simulator scope, no staging/cloud behavior changes.

## Validation evidence

- `npm run build -w @crewcue/api && PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/routes/raceRooms.test.js` — pass (16 tests).
- `npm run test:memory -w @crewcue/api` — pass (109 passed, 3 skipped).
- `npm run verify` — pending final validation.

## Next 1-3 tasks

1. Run final validation (`npm run verify`) if environment supports full mobile/web build.
2. Open PR for `cursor/missing-test-coverage-fd9e` and confirm CI.
3. Future coverage candidate: manual checkpoint stop idempotency replay/release paths.

## Open risks/blockers

- No GitHub issue was created due automation write limitations for issues; document this in PR.
- No iOS simulator run: API test-only change, no mobile-visible behavior changed.

## Successor prompt

```text
On branch cursor/missing-test-coverage-fd9e, finish PR delivery for API route idempotency coverage. Tests added in services/api/src/routes/raceRooms.test.ts cover course update release/replay/conflict. Validate with npm run verify if possible, then open PR and confirm CI.
```
