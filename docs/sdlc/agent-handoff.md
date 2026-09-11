# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-11 (UTC)
- **Roadmap phase:** Test coverage automation for recent merged API/mobile-facing changes.
- **Branch / PR:** `cursor/missing-test-coverage-ff3a` -> PR #473.
- **Active issue:** No pre-filed issue; this environment has read-only `gh` guidance and no issue-creation MCP tool.
- **Acceptance:** Inspect recent merged code, add high-signal deterministic tests for a meaningful uncovered risk, avoid production behavior changes, and validate focused/API/root targets.
- **Guardrails:** Do not duplicate open PR #468/#472 invite-hydrate coverage; no mobile UI, contract, schema, or production route changes in this coverage PR.

## Completed

- Added metrics-only `/activity-history` route regression coverage for unauthenticated requests, wrong `athleteUserId`, invalid numeric values, and strict-schema unknown fields.
- Confirmed rejected metrics-only writes leave the activity-history store empty.
- Reviewed recent merged PRs and skipped already-covered/open-owned race-room invite hydrate paths.

## Next 1-3 tasks

1. Merge the metrics-only activity-history validation coverage PR after CI is green.
2. Continue deconflicting with open coverage PRs (#467-#472) before touching overlapping API test files.
3. After open coverage PRs settle, revisit remaining activity-history edge cases such as invalid `recordedAt` error mapping if still untested.

## Validation evidence

- `npm run build -w @crewcue/api && PERSISTENCE_MODE=memory node --test /workspace/services/api/dist/services/api/src/routes/activityHistory.test.js` -> pass (12/12).
- `npm run test:memory -w @crewcue/api` -> pass (301 pass, 4 skipped).
- `npm run verify` -> pass.

## Open risks/blockers

- GitHub issue was not created because `gh` is read-only in this automation environment and no issue-creation MCP tool is configured.
- Mobile simulator proof is N/A: API test-only change under `services/api/**`.

## Successor prompt

```text
Review recent merged code after #467-#472 settle; avoid owned paths, add one focused deterministic regression test for the highest-risk uncovered API/client utility edge, then run focused tests plus npm run verify.
```
