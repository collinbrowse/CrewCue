# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-11 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-663f`
- **Issue:** none created for this automation run.
- **PR:** pending automation PR from `cursor/critical-bug-investigation-663f`.
- **Acceptance criteria:** fix high-confidence critical bugs; keep patch minimal; add regression tests; run local parity verification.

## Completed (this session)

- Secured `/chat/push/webhook`: requires authenticated sender, verifies sender and recipients are current room members, and returns aggregate delivery data only.
- Scoped chat push device upserts by `(user_id, device_id)` in memory/Postgres plus migration `0014_chat_push_devices_user_scope.sql`, preventing cross-user device id squatting.
- Made `restoreIdentityWithBackup` fail closed when a server backup exists but cannot be decrypted, avoiding replacement chat identity registration that strands existing envelopes.
- Prevented empty-room channel-key split-brain: only the deterministic distributor creates v1 envelopes; non-distributors wait for sync.
- Wrapped Postgres room-key rotation envelope purge + version bump in one transaction.
- Do-not-change guardrails honored: no mobile UI changes, no contracts reshaping, no broad chat refactor.

## Validation evidence

- `npm run test -w @crewcue/chat-crypto` — pass (10 tests).
- `npm run test:memory -w @crewcue/api` — pass (108 pass, 3 skipped).
- `npm run verify` — pass (builds, lint, typecheck, tests, mobile startup smoke/export, web/API builds).

## Next 1-3 tasks

1. Confirm automation PR CI green before merge.
2. Add first-class Stream webhook HMAC/raw-body verification before exposing provider webhooks directly.
3. Follow-up chat history hardening: versioned local room-key history so post-removal rotations preserve authorized pre-rotation reads.

## Open risks/blockers

- No GitHub issue was created for this automation run.
- Webhook auth is now app-user JWT based; direct Stream provider webhook delivery still needs signed raw-body verification before use.
- Deterministic distributor uses the lexicographically first current member with a matching public key; if that member never syncs, others return `syncing` rather than risk conflicting keys.
- No iOS simulator run: API/package-only behavior changed, not mobile UI.

## Successor prompt

```text
On cursor/critical-bug-investigation-663f, review the critical chat hardening PR: secured push webhook/device ownership, fail-closed identity backup restore, deterministic v1 room-key bootstrap, and transactional Postgres key rotation. Confirm CI green; next hardening is Stream HMAC raw-body verification and versioned local room-key history.
```
