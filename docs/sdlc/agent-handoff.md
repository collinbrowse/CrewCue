# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-26 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-ee0f` (chat outbox stuck-`sending` reclaim).
- **Active follow-up:** Merge outbox reclaim PR; also #334 sign-out wipe still open on main.

## Completed

- Found critical chat outbox bug: `markSending` refused persisted `sending`, so force-quit mid-send stranded messages with no retry UI. Fixed with live in-flight claims + reclaim, stable Stream client message ids, and duplicate-id treated as success.
- Open #334 still covers cross-account plaintext cache/outbox wipe on sign-out (not duplicated here).

## Next 1-3 tasks

1. Merge chat outbox reclaim PR after CI; smoke: send message, force-quit mid-send, reopen → message delivers (or clears as duplicate-id success).
2. Merge #334 (sign-out local wipe) when ready.
3. Staging deploy + signed-in chat smoke (migrate 0014, read receipts, `CHAT_PUSH_WEBHOOK_SECRET` if needed).

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Pre-fix outbox entries sent without client message ids can still duplicate if crash was after Stream ack (new sends are idempotent).
- Staging DB must get migration 0014 via Railway deploy.

## Successor prompt

```text
Merge outbox reclaim PR + #334 if open. Staging: confirm 0014; smoke chat send/photo, kill-mid-send reopen, sign-out account switch, peer read receipt.
```
