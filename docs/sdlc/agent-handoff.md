# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-22 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `main` @ `0d1fa3e` (#327 merged; #326/#328/#329 closed).
- **Active follow-up:** Staging deploy + signed-in chat smoke.

## Completed

- Merged #327: per-message “Read by everyone” under own bubbles; live `message.read` updates; older-history scroll preserve; idle roster members without read state do not block receipts.
- Earlier: #324 plaintext chat; #325 push webhook auth; #304/#312 idempotency; #322 env switch; obsolete Bugbot coverage PRs closed.

## Next 1-3 tasks

1. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
2. Signed-in smoke on staging (reload app from main): send + photo; peer read → receipt under own bubble; scroll-up history stays anchored.
3. Set `CHAT_PUSH_WEBHOOK_SECRET` if server-to-server push fanout needs it.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Staging DB must get migration 0014 via Railway deploy.
- Stream `messaging` channel type needs Read Events enabled for receipt broadcasts.

## Successor prompt

```text
#327 on main. Deploy staging (confirm 0014). Reload mobile from main; smoke chat send/photo, peer read receipt under own bubble, load-older scroll. Set CHAT_PUSH_WEBHOOK_SECRET if needed.
```
