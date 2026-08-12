# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-12 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 0 unlock complete; Wave 1 starting.
- **Branch / PR:** none open for Wave 0. Next: W1-1 [#364](https://github.com/collinbrowse/CrewCue/issues/364).
- **Active:** Execute W1-1 (API waypoint CRUD + tags).

## Completed

- W0-1 contracts DTOs (#361 / [#362](https://github.com/collinbrowse/CrewCue/pull/362)).
- W0-2 fixture pack (#358 / [#363](https://github.com/collinbrowse/CrewCue/pull/363)); staff review aligned golden clocks to moving-time and history climb to parsed GPX.
- W0-3 labels/milestone/epic (#359). Epic #360 still open.

## Next 1-3 tasks

1. Execute W1-1 #364 (course waypoint CRUD + tags).
2. After #364 merges, mark W1-2 Ready (notes + delay overrides).
3. W1-3 schedule sheet projection may start after W1-1 if it avoids `raceRooms.ts` waypoint handlers.

## Open risks/blockers

- Golden schedule clocks are moving-time only; W1-3 must decide whether dwell shifts later ETAs.
- Long-trail fixture is synthetic (~4568 m gain); do not treat as a realistic athlete profile.
- Strava OAuth / AI model port still need staging secrets design in W3.

## Successor prompt

```text
Execute #364 (W1-1 API waypoint CRUD + tags). Do not start W1-2 until #364 is on main. Prefer fixtures/pacing/course-50k-with-aids.gpx. Do not edit this handoff file; leave a PR Handoff delta.
```
