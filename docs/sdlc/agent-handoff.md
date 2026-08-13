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
- **Branch / PR:** W1-1 [#366](https://github.com/collinbrowse/CrewCue/pull/366) merged (`Closes #364`).
- **Active:** Execute W1-2 [#367](https://github.com/collinbrowse/CrewCue/issues/367) (per-stop notes + delay overrides).

## Completed

- Wave 0 unlock: contracts #362, fixtures #363, process #359.
- W1-1 waypoint tags + checkpoint CRUD (#364 / #366). Staff review added GET-after-mutate tests.

## Next 1-3 tasks

1. Execute W1-2 #367 (plan-scoped notes + delay overrides).
2. After #367 merges, W1-3 schedule sheet projection (read overlays; do not edit stop-plan module).
3. W1-4 mobile schedule sheet UI after W1-3.

## Open risks/blockers

- Golden schedule clocks are moving-time only; W1-3 must decide whether dwell + delayOverride shift later ETAs.
- POST waypoint still appends then forward-projects; mid-course inserts can snap near finish.
- Strava OAuth / AI model port still need staging secrets design in W3.

## Successor prompt

```text
Execute #367 (W1-2 stop-plan notes + delay overrides). New routes file; do not edit W1-1 checkpoint CRUD. Cover every EC row with GET-after-mutate. Do not edit agent-handoff.md.
```
