# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-05-20 (UTC)
- **Branch:** `feature/practical-e2e-crew-chat` (local, not pushed)
- **Issue:** [#288](https://github.com/collinbrowse/CrewCue/issues/288) — Practical E2E crew chat
- **Plan:** `docs/sdlc/plans/practical-e2e-crew-chat.md`

## Completed (this session)

- ADR **0006** practical E2E crew chat (user identity, backup, rotate on remove).
- Contracts: `ChatUserIdentity`, `ChatIdentityBackup`, user-scoped `ChatKeyEnvelope`, `ChatPushDevice*`.
- Migration **0013** + `chatPersistence` rewrite (`chat_user_identity`, `chat_identity_backup`, `chat_room_crypto_state`, user envelopes, `chat_push_devices`).
- API routes: identity, backup, user-scoped envelopes; `/chat/devices` push-only; member remove calls `rotateRoomChannelKey`.
- Package **`@crewcue/chat-crypto`** with unit tests; mobile wired (`chatKeySync`, `secureStorageAdapter`, no fatal missing-room-key).
- Runbooks updated (`chat-smoke.md`, `chat-push-decryption.md`).

## Validation evidence

- `npm run verify` — green
- `npm run test -w @crewcue/chat-crypto` — 5/5
- `npm run test:memory -w @crewcue/api` — 106 pass (3 skipped)
- `npm run agent:ios:ready` — OK (sim `3D6B4E19-…`)
- **iOS chat acceptance:** blocked — sim on guest/deeplink prompt; Auth0 login required for crew chat flows

## Next 1-3 tasks

1. Push branch, open PR with `Closes #288`, PR sim notes after Auth0 test login (or staging test account).
2. Staging: `db:migrate` through **0013** before chat soak.
3. Optional: Maestro flows under `apps/mobile/.maestro/` for chat key sync smoke.

## Open risks/blockers

- Full sim chat criteria need authenticated test user (existing human blocker).
- Member-remove rotation requires remaining clients to re-wrap at new `latestRoomKeyVersion` (foreground `syncAllRoomKeys`).

## Successor prompt

```text
On branch feature/practical-e2e-crew-chat: push, gh pr create (Closes #288), complete iOS sim chat acceptance with Auth0 test user per docs/sdlc/ios-simulator-agent-qa.md. Staging migrate 0013 before soak.
```
