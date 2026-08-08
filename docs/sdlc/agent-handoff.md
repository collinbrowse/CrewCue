# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-08 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-6f55` — fix out-of-order athlete ping acceptance.
- **Active follow-up:** Merge this fix; then staging chat smoke / unmerged drafts as prioritized.

## Completed

- Critical bug hunt (skipped open drafts #334–#348).
- Fixed: `POST /race-rooms/:roomId/pings` accepted `recordedAt` ≤ last accepted (motion gate skipped), overwriting `lastAccepted` and regressing projection. Reject reason `stale_recorded_at` + regression in `raceRoomPings.test.ts`.

## Next 1-3 tasks

1. Merge out-of-order ping fix PR; confirm CI green.
2. Optionally: invite accept must not demote `athleteId` role (medium confidence).
3. Staging deploy + signed-in chat smoke (#327 follow-up) when not blocked on Auth0.

## Open risks/blockers

- Open draft correctness PRs #334–#347 still unmerged (incl. #347 athlete-only ping authz).
- Auth0 still blocks unattended sim chat E2E.

## Successor prompt

```text
After merge of stale_recorded_at ping fix: pick next highest-severity unmerged draft (#347 athlete ping authz preferred), or run staging chat smoke if deploy ready. Skip rediscovering #334–#346.
```
