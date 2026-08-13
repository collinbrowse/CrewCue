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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 1 feature packages complete; integration next.
- **Branch / PR:** W1-5 [#380](https://github.com/collinbrowse/CrewCue/pull/380) merged (`Closes #378`).
- **Active:** Execute W1-I [#381](https://github.com/collinbrowse/CrewCue/issues/381) (schedule E2E + unlock Wave 2).

## Completed

- Wave 0 unlock; W1-1…W1-5 (waypoints, stop-plans, schedule API, mobile read, mobile edit).
- Auth0-free mobile proof via `crewcue://dev/schedule-sheet`.

## Next 1-3 tasks

1. Execute W1-I #381 (API schedule E2E + DEV mobile smoke + handoff + W2-1 Ready).
2. After #381 merges, launch W2-1 (check-in → reproject ETAs).
3. Then W2 parallel packages per program DAG.

## Open risks/blockers

- DEV fixture ≠ production clock source; W1-I must assert server-projected clocks via API.
- Authed Pace E2E still needs a test account.
- Strava OAuth / AI model port still need staging secrets design in W3.

## Successor prompt

```text
Execute #381 (W1-I). API E2E: seed course → delay → GET /schedule clock shift. DEV mobile smoke. Update agent-handoff.md. Mark W2-1 agent-ready. Do not implement Wave 2.
```
