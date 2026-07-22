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
- **Issues:** #326, #328, #329
- **PR:** #327
- **Acceptance criteria:** Read receipt under own bubbles only; live update on peer `message.read`; load-older keeps scroll; idle roster members without read state do not block.

## Completed

- Per-message “Read by everyone” under own bubbles (list footer removed).
- Live peerReads snapshot from `message.read` + channel.state.read.
- Peers = users with read frontiers (not full never-opened roster).
- Scroll preserve for older history (#328).

## Next 1-3 tasks

1. Two-sim smoke on #327: send → peer opens chat → receipt under sender’s bubble.
2. Merge #327 when OK.
3. Staging smoke on main after merge.

## Open risks/blockers

- Auth0 blocks unattended sim chat E2E.
- Stream channel type must allow `read_events` for markRead broadcasts.

## Successor prompt

```text
PR #327: reload Metro, two-sim smoke — receipt under own bubble when peer reads. Then merge.
```
