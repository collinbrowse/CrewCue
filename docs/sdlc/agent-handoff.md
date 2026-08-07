# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-07 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-20a4` (athlete ping authz fix).
- **Active follow-up:** Merge ping authz fix; then staging chat smoke from prior handoff.

## Completed

- Critical bug hunt: `POST /race-rooms/:roomId/pings` allowed any room member to forge athlete location/projection. Restricted to `room.athleteId`; regression in `raceRoomPings.test.ts`.

## Next 1-3 tasks

1. Review/merge athlete ping authz PR on `cursor/critical-bug-investigation-20a4`.
2. Deploy staging API; confirm migrate `0014` if not already; signed-in chat smoke.
3. Consider open drafts #334–#344 (membership/outbox races) separately — do not reopen blindly.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Many prior critical-bug draft PRs (#334–#344) still open/unmerged.
- Push webhook contract notes Stream user ids while tests/routes use Auth0 ids — verify before wiring Stream→API fanout.

## Successor prompt

```text
Ping authz fix on cursor/critical-bug-investigation-20a4: only room.athleteId may POST /pings. Review PR; then staging chat smoke / CHAT_PUSH_WEBHOOK_SECRET as needed. Do not reopen #334–#344 unless picking one deliberately.
```
