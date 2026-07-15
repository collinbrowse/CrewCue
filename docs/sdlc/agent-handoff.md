# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-15 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream).
- **Branch:** `feature/remove-chat-encryption-mvp`
- **Issue:** #323
- **PR:** #324
- **Acceptance criteria:** Remove E2E chat crypto; plaintext send/receive; no Syncing secure chat; ADR 0007; verify + sim notes.

## Completed (this session)

- Removed `@crewcue/chat-crypto` and mobile/API identity, backup, envelope, and push-decrypt bridges.
- Mobile chat sends/reads Stream `text`; bootstrap is token + connect only.
- Push webhook uses optional `previewText`; migration `0014_drop_chat_crypto.sql`.
- ADR 0006 superseded by ADR 0007; runbooks updated (`chat-smoke`, `chat-push`, `chat-retention`).

## Validation evidence

- `npm run verify` — pass.
- `npm run agent:ios:ready` — pass (sim booted). Full chat send/receive on sim blocked: Auth0 login required; XcodeBuildMCP tap tools not enabled in this session (snapshot/screenshot only).

## Next 1-3 tasks

1. Open/merge PR for #323; deploy API migration 0014 to staging.
2. Manual smoke on a signed-in device: open chat, send text/photo, confirm no sync-key UI.
3. Close obsolete draft crypto automation PRs (#308/#311/#317 etc.) as won’t-fix / obsolete.

## Open risks/blockers

- Historical Stream messages that only stored ciphertext will not show readable text.
- Agent cannot complete Auth0 chat E2E on simulator without a test account / deeplink fixture.
- Env-switch work (#321 / PR #322) is separate and still open on another branch.

## Successor prompt

```text
PR #324 (feature/remove-chat-encryption-mvp, #323): plaintext MVP chat. Confirm CI green, merge, run migration 0014 on staging, then smoke send/receive while signed in. Close obsolete crypto draft PRs.
```
