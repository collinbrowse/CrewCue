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
- **Roadmap phase:** Crew schedule + AI pacing — W1-1 merged; W1-2 next.
- **Branch / PR:** coverage branch `cursor/missing-test-coverage-bc96` / [#369](https://github.com/collinbrowse/CrewCue/pull/369).
- **Active:** Coverage follow-up for #366 map-workspace waypoint tag path.

## Completed

- W0-1 contracts DTOs (#361 / [#362](https://github.com/collinbrowse/CrewCue/pull/362)).
- W0-2 fixture pack (#358 / [#363](https://github.com/collinbrowse/CrewCue/pull/363)); staff review aligned golden clocks to moving-time and history climb to parsed GPX.
- W0-3 labels/milestone/epic (#359). Epic #360 still open.
- W1-1 API waypoint CRUD + tags (#364 / [#366](https://github.com/collinbrowse/CrewCue/pull/366)).
- Coverage follow-up: `services/api/src/routes/raceRooms.waypoints.test.ts` now covers `PUT /map-workspace` valid tag persistence and invalid-tag non-mutation. Validation: `npm run test:memory -w @crewcue/api`, `npm run verify`.

## Next 1-3 tasks

1. Review/merge coverage PR [#369](https://github.com/collinbrowse/CrewCue/pull/369).
2. Mark W1-2 Ready (notes + delay overrides).
3. W1-3 schedule sheet projection may start if it avoids any active `raceRooms.ts` waypoint-handler PR.

## Open risks/blockers

- Golden schedule clocks are moving-time only; W1-3 must decide whether dwell shifts later ETAs.
- Long-trail fixture is synthetic (~4568 m gain); do not treat as a realistic athlete profile.
- Strava OAuth / AI model port still need staging secrets design in W3.
- Coverage automation cannot create the required GitHub issue in this environment because `gh` is read-only and no issue-creation MCP is available.

## Successor prompt

```text
Review/merge waypoint tag coverage PR #369, then mark W1-2 Ready (notes + delay overrides). Keep any W1-3 schedule projection work clear of active `raceRooms.ts` waypoint-handler changes.
```
