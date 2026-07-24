# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-24 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-6000` (base `main` @ `e0d1578`).
- **Active follow-up:** Sign-out local-data wipe PR; staging deploy + signed-in chat smoke.

## Completed

- Critical bug hunt 2026-07-24: sign-out / expired-session teardown now clears plaintext transcript caches, chat outboxes (+ room index), notif pref caches for known rooms, sync outbox, and disconnects Stream — prevents cross-account cache leak and wrong-user outbox drain after #324.
- Earlier on main: #327 read receipts; #331 handoff; #325 push webhook auth; #324 plaintext chat.

## Next 1-3 tasks

1. Merge sign-out local wipe PR; create tracking GitHub issue if still missing (cloud `gh` was read-only).
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke: sign-out/sign-in as second account on same device must not paint prior transcript or send prior outbox; then chat send/photo + read receipts.

## Open risks/blockers

- Push devices remain registered for the previous Auth0 user until server-side deregister follow-up.
- Auth0 still blocks unattended sim chat E2E.
- Open PR #333 (map banner loop) is separate and should land independently.
- Staging DB must get migration 0014 via Railway deploy.

## Successor prompt

```text
Land sign-out local wipe PR if open. Create GitHub issue for it if missing. Staging deploy (0014). Smoke: account switch on device must not leak chat cache/outbox; then chat send/photo + receipts.
```
