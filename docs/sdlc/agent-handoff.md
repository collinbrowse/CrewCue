# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-06-04 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-c22b`
- **Issue:** none created by this cron automation (no write-capable issue tool available).
- **PR:** pending creation from this branch.
- **Acceptance criteria:** fix only high-confidence critical bugs; keep patch minimal; add regression tests; run local parity verification.

## Completed (this session)

- Fixed chat crypto backup snapshots so syncing one room preserves decryptable/known room keys for other rooms instead of replacing the server backup with only the current room.
- Fixed server-rotation handling so a cached room key is trusted only when its version is current; after a member-removal bump with no envelopes, the deterministic first remaining member distributes a fresh key at the bumped version.
- Added regression coverage in `packages/chat-crypto/src/roomKey.test.ts` for multi-room backup preservation and stale cached-key rotation.
- Do-not-change guardrails honored: no API contract changes, no mobile UI changes, no broad idempotency/API refactor, no simulator evidence committed.

## Validation evidence

- `npm run test -w @crewcue/chat-crypto` — pass (7 tests, including both new regressions).
- `npm run typecheck -w @crewcue/chat-crypto` — pass.
- `npm run verify` — pass, including lint, typecheck, workspace tests, builds, and mobile Expo export.

## Next 1-3 tasks

1. Review/merge PR after CI green.
2. Follow-up hardening: decide whether identity registration should fetch/decrypt backup before upserting a new public key.
3. Separate critical review of API idempotency partial-failure/retry paths; keep out of this PR unless independently reproduced.

## Open risks/blockers

- No GitHub issue was created because this automation environment exposes `gh` as read-only and no dedicated issue-create tool is available.
- Deterministic distributor uses the lexicographically first remaining member with a matching public key; if that member never syncs, others return `syncing` rather than risk conflicting fresh keys.
- No iOS simulator run: package-only crypto behavior changed, not mobile UI.

## Successor prompt

```text
PR from cursor/critical-bug-investigation-c22b fixes chat crypto multi-room backup overwrite and stale cached key reuse after server rotation. Confirm CI green, then review merge. Optional next hardening: identity backup restore-before-register semantics and API idempotency partial-failure retries.
```
