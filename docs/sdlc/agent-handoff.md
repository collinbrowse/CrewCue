# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-11 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-d363` — athlete ping authz + stale recordedAt.
- **Active follow-up:** Merge this fix; close superseded drafts #347/#349; staging chat smoke.

## Completed

- Critical bug hunt: confirmed `POST /race-rooms/:roomId/pings` still allowed any room member to forge athlete GPS/projection, and still accepted out-of-order `recordedAt` (motion gate skipped) which could regress projection.
- Fix: require `identity.sub === room.athleteId`; reject `recordedAt <= lastAccepted` as `stale_recorded_at`. Regressions in `raceRoomPings.test.ts`; ping fixtures aligned in projection/raceRooms tests.

## Next 1-3 tasks

1. Review/merge ping ingest fix on `cursor/critical-bug-investigation-d363`; close drafts #347/#349 as superseded.
2. Staging deploy + signed-in chat smoke (#327 follow-up) when Auth0 allows.
3. Optionally pick next unmerged draft (#344 outbox RMW / #342 membership) — do not reopen blindly.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Many prior critical-bug draft PRs (#334–#346, #348, #340–#341, etc.) still open/unmerged.
- Push webhook Stream vs Auth0 user-id mismatch still unverified for Stream→API fanout.

## Successor prompt

```text
Ping ingest fix on cursor/critical-bug-investigation-d363: athlete-only pings + stale_recorded_at. Merge/close #347/#349 duplicates. Next: staging chat smoke, or deliberately pick one open draft (#344/#342).
```
