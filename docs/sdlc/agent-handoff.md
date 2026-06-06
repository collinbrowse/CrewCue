# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-06-06 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-10ef`
- **Issue:** none created for this cron automation run.
- **PR:** pending for this branch.
- **Acceptance criteria:** fix only high-confidence critical bugs; keep patch minimal; add regression tests; run local parity verification.

## Completed (this session)

- Fixed chat key-envelope upload authorization so a room member cannot persist envelopes for non-member recipients.
- Added regression coverage proving `/chat/rooms/:roomId/key-envelopes` rejects outsider recipients with `403`.
- Disproved a suspected chat-crypto backup downgrade path: `ensureRoomKeyReady` restores decryptable server backup state before pushing a new snapshot.
- Do-not-change guardrails honored: no API contract changes, no mobile UI changes, no broad chat crypto refactor.

## Validation evidence

- Pre-fix `npm run test -w @crewcue/api` — failed as expected: new non-member recipient regression returned `201 !== 403`.
- Post-fix `npm run test -w @crewcue/api` — pass (112 tests, 109 pass, 3 skipped; new regression `ok 49`).
- `npm run test -w @crewcue/chat-crypto` — pass (8 tests).
- `npm run typecheck -w @crewcue/api` — pass.
- `npm run verify` — pass, including workspace tests, mobile startup smoke, and `expo export --platform all`.

## Next 1-3 tasks

1. Open PR for `cursor/critical-bug-investigation-10ef` and confirm CI green.
2. Follow-up hardening: decide whether identity registration should fetch/decrypt backup before upserting a new public key.
3. Separate critical review of API idempotency partial-failure/retry paths.

## Open risks/blockers

- No GitHub issue was created for this automation run.
- No iOS simulator run: API-only authorization fix, no mobile UI change.
- The push webhook endpoint remains unauthenticated by design/current implementation; not investigated as part of this focused fix.

## Successor prompt

```text
Branch cursor/critical-bug-investigation-10ef fixes chat key-envelope recipient authorization: uploads now require every envelope recipient to be a current room member, with API regression coverage. Confirm PR CI green, then merge. Optional next hardening: identity backup restore-before-register semantics and API idempotency partial-failure retries.
```
