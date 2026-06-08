# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-06-08 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-cc99`
- **Issue:** none created for this cron automation run.
- **PR:** pending/opened from this branch for undecryptable chat backup hardening.
- **Acceptance criteria:** fix high-confidence critical bug; keep patch minimal; add regression tests; run local parity verification.

## Completed (this session)

- Found a critical chat crypto data-loss path: when a server identity backup exists but cannot be decrypted locally, `restoreIdentityWithBackup` registered a fresh identity and `pushBackupSnapshot` could overwrite the server backup with only local/current-room keys.
- Fixed the undecryptable-backup path to be non-mutating: no fresh identity registration and no backup upload when an existing backup cannot be decrypted.
- Added regression tests for both server mutations.
- Do-not-change guardrails honored: no API contract changes, no mobile UI changes, no broad crypto/key-sync refactor.

## Validation evidence

- Pre-fix `npm run test -w @crewcue/chat-crypto` — failed on both new regressions (identity replaced; backup overwritten).
- Post-fix `npm run test -w @crewcue/chat-crypto` — pass (10 tests).
- Post-fix `npm run typecheck -w @crewcue/chat-crypto` — pass.
- `npm run verify` — pass.

## Next 1-3 tasks

1. Confirm PR CI green after push.
2. Decide whether to add explicit UI/recovery messaging for undecryptable backups rather than silent syncing.
3. Separately triage the possible authenticated join-flow lockout noted during review.

## Open risks/blockers

- No GitHub issue was created for this cron automation run.
- Existing backup decrypt failure now preserves server state but may leave the device unable to recover historical room keys until the correct backup secret/identity is restored.
- No iOS simulator run: package-only crypto behavior changed, not mobile UI.

## Successor prompt

```text
On cursor/critical-bug-investigation-cc99, verify the undecryptable chat backup hardening PR CI is green. The fix prevents identity registration and backup upload when an existing server backup cannot be decrypted; package tests and npm run verify passed locally. Optional follow-up: recovery UX for undecryptable backups and separate join-flow lockout triage.
```
