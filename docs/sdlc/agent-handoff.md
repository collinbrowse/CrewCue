# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-21 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream).
- **Branch:** `fix/chat-read-by-everyone-326`
- **Issues:** #326 (read receipts), #328 (scroll preserve on load-older)
- **PR:** #327
- **Acceptance criteria:** No false “Read by everyone”; footer can light via message-id or safe last_read vs UI latest own; load-older keeps viewport anchored.

## Completed

- Strict read-receipt helper + UI latest-own; restored last_read fallback only with UI-sourced latest own.
- Scroll: removed `autoscrollToTopThreshold`; overlay loader; content-height delta scroll adjust on prepend.

## Next 1-3 tasks

1. Human smoke on #327 branch: scroll-up history + two-sim read footer.
2. Merge #327 when green.
3. Staging deploy / chat smoke on main after merge.

## Open risks/blockers

- Auth0 blocks unattended sim chat E2E.
- “Read by everyone” needs every other Stream channel member to have read the latest *own* message (not per-message ticks).

## Successor prompt

```text
On PR #327: reload Metro, smoke load-older scroll anchor + two simulators for Read by everyone. Merge when OK.
```
