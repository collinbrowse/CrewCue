# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-07 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-c428`
- **Issue:** none created for this automation run.
- **PR:** pending automation PR creation.
- **Acceptance criteria:** fix high-confidence critical bugs; keep patch minimal; add regression tests; run local parity verification.

## Completed (this session)

- Fixed fresh-device/secret-mismatch chat backup recovery so an undecryptable existing server backup no longer registers a generated identity or overwrites the server backup.
- Added cached room-key reconciliation: if the caller has a decryptable same-version-or-newer server envelope that disagrees with local cache, prefer the server envelope to converge split-brain bootstrap races.
- Kept scope to `packages/chat-crypto`; no API contract changes and no mobile UI changes.

## Validation evidence

- `npm run test -w @crewcue/chat-crypto` — pass (10 tests, including new backup-clobber and envelope-reconciliation regressions).
- `npm run typecheck -w @crewcue/chat-crypto` — pass.
- `npm run verify` — pass.

## Next 1-3 tasks

1. Confirm automation PR CI is green after creation.
2. Follow-up hardening: preserve per-room key history by key version so member-removal rotation does not hide pre-rotation messages.
3. Continue critical review of API idempotency partial-failure/retry paths.

## Open risks/blockers

- No GitHub issue was created for this automation run.
- Existing installs already clobbered by prior code cannot recover lost old private keys without an external backup.
- No iOS simulator run: package-only crypto behavior changed, not mobile UI.

## Successor prompt

```text
On branch cursor/critical-bug-investigation-c428, review the PR for chat-crypto fixes that stop undecryptable server backups from being clobbered on fresh devices and reconcile cached room keys to decryptable server envelopes. Validate CI green; next critical follow-up is versioned local room-key history for post-rotation message decryptability.
```
