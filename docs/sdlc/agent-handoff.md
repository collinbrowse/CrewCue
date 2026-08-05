# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-05 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-a653` (base `main` @ `e0d1578`).
- **Active follow-up:** Chat outbox SecureStore RMW fix (this branch); staging deploy still pending from prior handoff.

## Completed

- Critical bug: concurrent chat outbox RMW could drop a second send when `markSent`/`removeEntry` raced with `enqueueChatMessage` (rapid double-send while first network call finishes). Fixed via per-room serialized mutate in `messageQueueStore`.
- Prior on main: #327 read receipts; #324 plaintext chat; #325 push webhook; #304/#312 idempotency; #322 env switch.

## Next 1-3 tasks

1. Merge this chat outbox RMW fix; keep open drafts #334–#342 as separate follow-ups (do not reopen).
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke on staging: send + photo; peer read receipt; rapid double-send still durable after relaunch.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Open draft criticals remain: #342 membership LWW, #340 sync outbox batch merge, #335 stuck sending reclaim, etc.
- Stream `messaging` channel type needs Read Events enabled for receipt broadcasts.

## Successor prompt

```text
Chat outbox RMW fix on cursor/critical-bug-investigation-a653. Review/merge. Do not reopen #334–#342. Staging: migrate 0014 + signed-in chat smoke including rapid double-send persistence.
```
