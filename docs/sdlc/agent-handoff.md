# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-06-05 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-c22b`
- **Issue:** none created for this automation run.
- **PR:** #296 — Fix chat crypto backup and rotation data loss.
- **Acceptance criteria:** fix high-confidence critical bugs; keep patch minimal; add regression tests; run local parity verification.

## Completed (this session)

- Fixed chat crypto backup snapshots so syncing one room preserves decryptable/known room keys for other rooms instead of replacing the server backup with only the current room.
- Fixed server-rotation handling so a cached room key is trusted only when its version is current; after a member-removal bump with no envelopes, the deterministic first remaining member distributes a fresh key at the bumped version.
- Merged `main` into PR #296; resolved conflicts in `roomKey.test.ts` and `agent-handoff.md`, keeping all regression tests (multi-room backup, stale cached-key rotation, backup restore).
- `restoreIdentityWithBackup` (from merged `main`) registers the restored public key after a valid backup instead of a transient generated identity.
- Do-not-change guardrails honored: no API contract changes, no mobile UI changes, no broad idempotency/API refactor.

## Validation evidence

- `npm run test -w @crewcue/chat-crypto` — pass (8 tests, including all regressions).
- `npm run typecheck -w @crewcue/chat-crypto` — pass.
- `npm run verify` — pending post-merge commit.

## Next 1-3 tasks

1. Push merge commit and confirm PR #296 CI green.
2. Follow-up hardening: decide whether identity registration should fetch/decrypt backup before upserting a new public key.
3. Separate critical review of API idempotency partial-failure/retry paths.

## Open risks/blockers

- No GitHub issue was created for this automation run.
- Deterministic distributor uses the lexicographically first remaining member with a matching public key; if that member never syncs, others return `syncing` rather than risk conflicting fresh keys.
- No iOS simulator run: package-only crypto behavior changed, not mobile UI.

## Successor prompt

```text
PR #296 on cursor/critical-bug-investigation-c22b fixes chat crypto multi-room backup overwrite, stale cached key reuse after server rotation, and includes merged backup-restore registration coverage. Confirm CI green, then merge. Optional next hardening: identity backup restore-before-register semantics and API idempotency partial-failure retries.
```
