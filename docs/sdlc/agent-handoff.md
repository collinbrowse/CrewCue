# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-21 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — read-receipt correctness.
- **Branch:** `fix/chat-read-by-everyone-326`
- **Issue:** #326
- **PR:** #327
- **Acceptance criteria:** “Read by everyone” only when every other Stream member has `last_read_message_id` through latest delivered own message; no timestamp-only false positives; unit tests.

## Completed

- Merged #322 env switch; #324–#325/#304/#312 on main.
- Diagnosed false “Read by everyone”: loose `last_read >= createdAt` + stale `channel.state` latest-own.
- Extracted `readReceipts.ts` with strict message-id checks; wired `CrewChatScreen`.

## Next 1-3 tasks

1. Open/merge PR for #326; re-smoke on staging after reload.
2. Deploy staging API if 0014 not yet applied; confirm migrate logs.
3. Set `CHAT_PUSH_WEBHOOK_SECRET` if server push fanout needs it.

## Open risks/blockers

- Auth0 blocks unattended sim chat E2E — human signed-in smoke required for footer proof.
- Staging DB migration 0014 via Railway deploy.

## Successor prompt

```text
PR for #326 (false Read by everyone). Confirm CI, merge, reload mobile against staging, smoke: send message → footer off until peer reads.
```
