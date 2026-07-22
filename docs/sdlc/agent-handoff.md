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
- **Branch:** `fix/332-map-error-banner-loop` (uncommitted fix for #332).
- **Active:** [#332](https://github.com/collinbrowse/CrewCue/issues/332) — stop repeating error banners from map auto-fetch loop.

## Completed (this session)

- Diagnosed constant “Something went wrong. Please try again.” banners: map `useEffect` depended on entire shell `s` (new every render) → infinite `onFetchRoomDetails` / `onFetchInvites`; failures → `setStatusError` → transient banner.
- Fix drafted: roomId-only effect + quiet auto-fetch; map focus uses quiet projection; noticeBus dedupe survives dismiss.

## Next 1-3 tasks

1. Commit + open PR for #332 (`Closes #332`); run `npm run verify`; sim smoke if signed in.
2. Staging deploy + signed-in chat smoke from prior handoff (#327).
3. Set `CHAT_PUSH_WEBHOOK_SECRET` if push fanout needs it.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E; banner-loop sim proof needs signed-in room.
- Staging API failures still possible; should no longer spam banners after #332.

## Successor prompt

```text
Finish #332: commit on fix/332-map-error-banner-loop, npm run verify, gh pr create with Closes #332. Optional signed-in map smoke (no spam banners). Then staging chat smoke from prior handoff.
```
