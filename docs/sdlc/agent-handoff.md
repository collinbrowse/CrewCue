# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-12 (UTC)
- **Roadmap phase:** Regression coverage automation / API idempotency hardening.
- **Branch:** `cursor/missing-test-coverage-a870`
- **Issue:** none created; automation environment has read-only `gh` guidance and no issue-creation MCP tool.
- **PR:** pending for this branch.
- **Acceptance criteria:** inspect recent merged code, add minimal high-signal tests for meaningful regression risk, avoid production behavior changes, run relevant tests and local parity verification.

## Completed (this session)

- Reviewed recent merged changes and prioritized route-level idempotency coverage from platform/actions work over already-covered chat crypto fixes and cosmetic mobile changes.
- Added `services/api/src/routes/raceRooms.test.ts` coverage for `PUT /race-rooms/:roomId/course` idempotent retry replay and conflicting key reuse.
- Added coverage that `PUT /race-rooms/:roomId/course` releases an idempotency claim after semantic validation failure so a corrected retry with the same key can proceed.
- Added coverage for `POST /race-rooms/:roomId/checkpoints/:cpId/manual-stop` idempotent retry replay and conflicting key reuse.
- No production behavior changes; no API contract or mobile UI changes.

## Validation evidence

- Initial `npm run test:memory -w @crewcue/api` failed because dependencies were not installed (`tsc: not found`).
- `npm install` — pass; installed workspace dependencies and ran postinstall package builds.
- `npm run test:memory -w @crewcue/api` — pass (114 tests; 111 pass, 3 skipped).
- `npm run verify` — pass.

## Next 1-3 tasks

1. Open PR for `cursor/missing-test-coverage-a870` and confirm CI green.
2. Future coverage candidate: Stream channel membership sync add/remove/duplicate-channel paths.
3. Future coverage candidate: platform event duplicate-key mismatch semantics across aggregate/payload differences.

## Open risks/blockers

- No GitHub issue was created due environment constraints (read-only `gh`, no issue-create MCP tool).
- Full verify passed locally; CI still needs to run on the PR.
- No iOS simulator run: API route tests only, no mobile UI or mobile-visible behavior changed.

## Successor prompt

```text
On branch cursor/missing-test-coverage-a870, API route tests now cover race-room course and manual-stop idempotent replay/conflict plus release after course semantic validation failure. PR should describe the added regression coverage and validation (`npm run test:memory -w @crewcue/api`, `npm run verify`).
```
