# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-25 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-9fc3` → PR #334 (base `main` @ `e0d1578`).
- **Active follow-up:** Merge #334; staging deploy + signed-in account-switch smoke.

## Completed

- Critical bug hunt 2026-07-25: PR #334 re-lands + hardens sign-out wipe (prior `6000` branch had no PR). Sign-out / expired-session clears plaintext transcript caches, chat outboxes (index + transcript-known rooms), notif prefs, sync outbox, and disconnects Stream. Pre-index outboxes heal via `loadOutbox`. `npm run verify` green.
- Earlier on main: #327 read receipts; #331 handoff; #325 push webhook auth; #324 plaintext chat.

## Next 1-3 tasks

1. Merge PR #334; create tracking GitHub issue if still required (cloud `gh` read-only).
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke: account switch on device must not paint prior transcript or drain prior outbox; then chat send/photo + read receipts.

## Open risks/blockers

- Push devices remain registered for the previous Auth0 user until server-side deregister follow-up.
- Auth0 still blocks unattended sim chat E2E.
- Open PR #333 (map banner loop) is separate and should land independently.
- Staging DB must get migration 0014 via Railway deploy.

## Successor prompt

```text
Merge #334 (sign-out local wipe). Staging deploy (0014). Smoke: account switch must not leak chat cache/outbox; then chat send/photo + receipts.
```
