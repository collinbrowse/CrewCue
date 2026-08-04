# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-04 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-8c04` (base `main`).
- **Active follow-up:** Land PR #342 (join LWW + course/join membership wipe); staging smoke still pending.

## Completed

- Concurrent join-by-code membership LWW fixed (`upsertRaceRoomMembership`).
- **New critical:** course/map-workspace/member/entitlement full-document `saveRaceRoom` wiped concurrent join memberships. Fixed via `applyRaceRoomUpdate` / `applyPersistedRaceRoomUpdate` (FOR UPDATE + memory membership lock). Regression: `course PUT concurrent with join-by-code keeps joiner membership`.
- Do not reopen drafts #334–#341.

## Next 1-3 tasks

1. Link GitHub issue for membership races; merge #342 after CI green.
2. Deploy staging API; signed-in chat smoke still outstanding from #327.
3. Optional: chat `messageQueue` SecureStore RMW; HTTP idempotency lease-owner reclaim.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Task-board in-memory concurrent mutators still unordered full-document persists (lower everyday likelihood than join/course).
- Staging DB must get migration 0014 via Railway deploy (prior).

## Successor prompt

```text
PR #342 on cursor/critical-bug-investigation-8c04: join membership upsert + applyRaceRoomUpdate for course/workspace/admin writers. Ensure CI green, link issue, merge. Then staging deploy + chat smoke.
```
