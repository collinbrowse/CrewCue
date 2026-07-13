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
- **Branch:** `cursor/critical-bug-investigation-4df2`
- **Issue:** none created for this automation run.
- **PR:** #317 — Fix chat identity recovery data loss.
- **Acceptance criteria:** fix high-confidence critical bugs; keep patch minimal; add regression tests; run local parity verification; document simulator blocker if mobile harness cannot run.

## Completed (this session)

- Investigated recent chat/mobile commits for critical correctness bugs and fixed two concrete chat key-recovery hazards.
- `restoreIdentityWithBackup` now fails closed when a server identity backup exists but cannot decrypt locally, preserving the existing server identity instead of registering a replacement key.
- Room-key catastrophic rekey now requires the full room roster to be truly solo; mobile chat bootstrap/sync passes `room.memberships.length` so a partially discovered identity roster cannot split-brain a multi-member room.
- `pushBackupSnapshot` skips backup overwrite when the server backup cannot decrypt locally.
- Added chat-crypto regressions for unreadable backup identity preservation and incomplete-roster rekey prevention.
- Do-not-change guardrails honored: no API contract changes, no mobile UI changes, no broad idempotency/API refactor.

## Validation evidence

- `npm run test -w @crewcue/chat-crypto` — pass (10 tests, including new regressions).
- `npm run typecheck -w @crewcue/chat-crypto` — pass.
- `npm run typecheck -w @crewcue/mobile` — pass.
- `npm run verify` — pass.
- `npm run agent:ios:ready` — blocked: runner is Linux and script requires macOS.

## Next 1-3 tasks

1. Confirm PR #317 CI green.
2. Run iOS simulator QA from a macOS runner if mobile-visible chat recovery needs manual proof beyond `agent:ios:ready`.
3. Continue separate critical review of remaining chat surfaces (push webhook auth/HMAC, versioned local key history).

## Open risks/blockers

- No GitHub issue was created for this automation run.
- iOS simulator QA is blocked in this Linux cloud environment (`agent:ios:ready requires macOS`).
- Deterministic distributor still depends on the first remaining member with a matching public key syncing after server rotation; others return `syncing` rather than risk conflicting fresh keys.

## Successor prompt

```text
On cursor/critical-bug-investigation-4df2, review the automation PR for chat key recovery: unreadable identity backups now fail closed without replacing server identity, backup snapshots do not overwrite unreadable server backups, and multi-member rooms cannot solo-rekey from incomplete identity rosters. Verify CI and, if a macOS runner is available, run iOS simulator QA because Linux blocked `agent:ios:ready`.
```
