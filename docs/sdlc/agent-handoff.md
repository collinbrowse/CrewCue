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
- **Branch / PR:** W1-2 [#371](https://github.com/collinbrowse/CrewCue/pull/371) merged (`Closes #367`).
- **Active:** Execute W1-3 [#372](https://github.com/collinbrowse/CrewCue/issues/372) (crew schedule sheet projection).

## Completed

- Wave 0 unlock: contracts #362, fixtures #363, process #359.
- W1-1 waypoint tags + checkpoint CRUD (#364 / #366); insert-by-progress #368; map-workspace tag coverage #369.
- W1-2 stop-plan notes + delay overlays (#367 / #371); staff review prunes ghost overlays on waypoint delete.

## Next 1-3 tasks

1. Execute W1-3 #372 (GET schedule sheet; cumulative prior dwell+delay shifts later ETAs).
2. After #372 merges, W1-4 mobile schedule sheet UI (read).
3. W1-5 mobile edit notes/delays after W1-2 + W1-4.

## Open risks/blockers

- `delayOverrideSeconds` is extra dwell, not a replacement. W1-3 must add it onto planned dwell for subsequent clocks only.
- Join live checkpoints for the sheet; do not iterate overlay rows as the course.
- Strava OAuth / AI model port still need staging secrets design in W3.

## Successor prompt

```text
Execute #372 (W1-3 GET /schedule). Cumulative prior dwell+delay shifts later ETAs. Do not rewrite schedule-expected.json. New raceRoomSchedule routes; do not edit stop-plan write paths. No agent-handoff.md edits.
```
