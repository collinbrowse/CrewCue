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
- **Branch:** `cursor/critical-bug-investigation-0663`
- **PR:** #325 — chat push webhook authorization (rebasing onto main post-#324).

## Completed

- Rebased #325 onto main after plaintext chat; webhook uses `previewText`.
- Closed obsolete/optional Bugbot PRs: #307, #309, #314, #316, #318–#320.

## Next 1-3 tasks

1. Finish merge of #325, then #304, then #312.
2. Deploy staging API (Railway migrate 0014) + signed-in chat smoke.
3. Configure `CHAT_PUSH_WEBHOOK_SECRET` if server-to-server push fanout cannot use sender JWT.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Staging DB must get migration 0014 via Railway deploy.

## Successor prompt

```text
Merge #325 (push webhook auth), then rebase/merge #304 and #312. Deploy staging and smoke chat.
```
