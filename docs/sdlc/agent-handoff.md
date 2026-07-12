# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-12 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-9610`
- **Issue:** none created for this automation run.
- **PR:** pending.
- **Acceptance criteria:** fix high-confidence critical bugs; keep patch minimal; add regression tests; run local parity verification.

## Completed (this session)

- Fixed unreadable identity-backup recovery so a fresh install cannot register a replacement chat identity when a server backup exists but cannot decrypt.
- Fixed backup snapshot upload so an existing unreadable server backup is preserved instead of overwritten by a smaller/current-room-only snapshot.
- Hardened key-envelope upload: recipients must be current room members, batches must use one positive allowed version, version jumps are rejected, and same-version conflicts no longer overwrite existing envelopes.
- Hardened `/chat/push/webhook`: requires authenticated sender or `CHAT_PUSH_WEBHOOK_SECRET`, validates sender/recipients against room membership, and stops returning push device metadata.
- Added chat crypto and API regression coverage for the failure modes above.

## Validation evidence

- `npm run test -w @crewcue/chat-crypto` — pass (10 tests).
- `npm run test:memory -w @crewcue/api` — pass (111 tests; 3 skipped).
- `npm run typecheck -w @crewcue/chat-crypto` — pass.
- `npm run typecheck -w @crewcue/api` — pass.
- `npm run verify` — pass.

## Next 1-3 tasks

1. Open PR from `cursor/critical-bug-investigation-9610` to `main` and confirm CI green.
2. Configure `CHAT_PUSH_WEBHOOK_SECRET` wherever unauthenticated Stream/server-to-server push fanout is used.
3. Follow-up: add raw-body Stream webhook HMAC verification if direct Stream webhooks are enabled.

## Open risks/blockers

- No GitHub issue was created for this automation run.
- Direct Stream provider webhooks still need production-specific signature wiring; this patch supports authenticated clients or a shared webhook secret.
- No iOS simulator run: API/package crypto behavior changed, not mobile UI.

## Successor prompt

```text
PR from cursor/critical-bug-investigation-9610 hardens chat backup restore, key envelopes, and push webhook auth. Confirm CI green; ensure staging/prod set CHAT_PUSH_WEBHOOK_SECRET if push fanout relies on unauthenticated server-to-server calls.
```
