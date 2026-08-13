# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-13 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 1 in progress.
- **Branch / PR:** W1-4 [#377](https://github.com/collinbrowse/CrewCue/pull/377) merged (`Closes #375`).
- **Active:** Execute W1-5 [#378](https://github.com/collinbrowse/CrewCue/issues/378) (mobile edit stop notes/delays).

## Completed

- Wave 0 unlock; W1-1–W1-3 API (waypoints, stop-plans, schedule projection).
- W1-4 mobile schedule sheet read (#375 / #377); staff review added `__DEV__` `crewcue://dev/schedule-sheet` for Auth0-free sim proof.

## Next 1-3 tasks

1. Execute W1-5 #378 (edit delay/notes; refetch schedule).
2. After #378 merges, W1-I integration (schedule E2E seed → sheet → note edit).
3. Then Wave 2 unlock (check-in → reproject) per program DAG.

## Open risks/blockers

- Prefer DEV schedule fixture for agent sim; authed Pace path still needs a test account for full API E2E.
- Display API clocks after save; do not recompute client-side.
- Strava OAuth / AI model port still need staging secrets design in W3.

## Successor prompt

```text
Execute #378 (W1-5 mobile edit stop notes/delays). Use stop-plan APIs; refetch getSchedule after save. Prefer crewcue://dev/schedule-sheet for sim. No agent-handoff.md edits.
```
