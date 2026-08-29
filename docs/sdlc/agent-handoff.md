# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-29 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing.
- **Branch / PR:** `cursor/critical-bug-investigation-cfd3` (getRaceRoom cache-miss clobber; sibling of #427).
- **Active next:** Merge this hydrate fix; redeploy staging; soak.

## Completed

- #427: list rooms no longer clobbers live room cache.
- This branch: `getRaceRoom` cache-miss load no longer `raceRooms.set` a stale SELECT over a newer in-process write.

## Next 1-3 tasks

1. Merge getRaceRoom hydrate fix; confirm CI green.
2. Redeploy staging API.
3. Smoke Profile GPX upload → Open Pace; Strava reconnect.

## Validation evidence

- Targeted: `raceRoomStopPlans.test.ts` getRaceRoom hydrate + existing list-clobber cases.

## Open risks/blockers

- Staging may still need Railway redeploy.
- Known drafts unchanged: #353 ping authz, #419 course-change wipe, #455 GPX stick.

## Successor prompt

```text
Merge getRaceRoom hydrate fix. Redeploy staging API. Smoke stop-plan save overlapping room GET after restart.
```
