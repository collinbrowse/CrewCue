# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-06 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-0257`
- **Issue:** none created for this automation run.
- **PR:** #308 — Fix chat key envelope version poisoning.
- **Acceptance criteria:** fix high-confidence critical bugs; keep patch minimal; add regression tests; run local parity verification.

## Completed (this session)

- Found a critical chat key-envelope poisoning path: any current room member could upload an arbitrary high `keyVersion` envelope for another member, advancing room crypto state and causing the victim client to reject cached keys and remain stuck syncing.
- Added API guards so key-envelope uploads must target current room members, use a single positive version per batch, and match allowed room crypto versions (`1` for first bootstrap, current version thereafter, plus existing solo rekey escape hatch).
- Added regression coverage for non-member recipient rejection and high-version jump rejection while preserving the original v1 envelope/latest version.
- Updated an older retention test fixture to use first-bootstrap key version `1`.
- Do-not-change guardrails honored: no contract changes, no mobile UI changes, no broad crypto/client refactor.

## Validation evidence

- Initial `npm run test:memory -w @crewcue/api` failed before dependency install because `tsc` was missing; ran `npm install`.
- `npm run test:memory -w @crewcue/api` — pass (112 tests).
- `npm run typecheck -w @crewcue/api` — pass.
- `npm run verify` — pass.

## Next 1-3 tasks

1. Confirm PR #308 CI green.
2. Consider follow-up hardening for same-version envelope overwrite races/immutability; not included here to keep the critical fix minimal.
3. Continue daily critical review of chat/API idempotency and crypto sync paths.

## Open risks/blockers

- No GitHub issue was created for this automation run.
- Existing same-version envelope overwrite behavior remains unchanged; this PR blocks version poisoning and non-member recipients but does not redesign envelope conflict resolution.
- No iOS simulator run: API-only behavior changed, not mobile UI.

## Successor prompt

```text
PR #308 on cursor/critical-bug-investigation-0257 implements API key-envelope recipient/version guards and passed `npm run verify`. Monitor CI, then optionally follow up on same-version envelope overwrite race hardening.
```
