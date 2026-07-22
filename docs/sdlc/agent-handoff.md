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
- **Branch / PR:** `fix/332-map-error-banner-loop` → [#333](https://github.com/collinbrowse/CrewCue/pull/333) (`Closes #332`).
- **Active:** Review/merge #333; then staging chat smoke from prior handoff.

## Completed

- #332/#333: stop repeating map error banners (roomId-only effect, quiet auto-fetch, noticeBus post-dismiss dedupe).
- `npm run verify` green locally before PR open.

## Next 1-3 tasks

1. Merge #333 when CI green; optional signed-in map idle smoke (no spam banners).
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in chat smoke on staging (send/photo/read receipt/scroll); set `CHAT_PUSH_WEBHOOK_SECRET` if needed.

## Open risks/blockers

- Auth0 blocks unattended sim proof for #333 banner absence.
- Staging DB must get migration 0014 via Railway deploy.

## Successor prompt

```text
Watch #333 CI; merge when green. Optional signed-in map smoke. Then staging deploy (0014) + chat smoke from prior handoff.
```
