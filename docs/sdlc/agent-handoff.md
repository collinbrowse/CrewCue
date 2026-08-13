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
- **Branch / PR:** W1-3 [#374](https://github.com/collinbrowse/CrewCue/pull/374) merged (`Closes #372`).
- **Active:** Execute W1-4 [#375](https://github.com/collinbrowse/CrewCue/issues/375) (mobile schedule sheet read UI).

## Completed

- Wave 0 unlock: contracts #362, fixtures #363, process #359.
- W1-1 waypoint tags + checkpoint CRUD (#364 / #366); insert-by-progress #368; map-workspace tag coverage #369.
- W1-2 stop-plan notes + delay overlays (#367 / #371).
- W1-3 GET `/schedule` with cumulative prior dwell+delay (#372 / #374).

## Next 1-3 tasks

1. Execute W1-4 #375 (mobile schedule sheet read UI + sim QA).
2. After #375 merges, W1-5 mobile edit notes/delays (depends W1-2 + W1-4).
3. W1-I integration after W1-* merge.

## Open risks/blockers

- Display API schedule clocks as returned; do not recompute client-side. GPX may stamp 600s planned dwell on start, shifting later ETAs.
- W1-4 requires iOS simulator proof on the PR (not under `docs/`).
- Strava OAuth / AI model port still need staging secrets design in W3.

## Successor prompt

```text
Execute #375 (W1-4 mobile schedule sheet read). getSchedule client + read-only UI. Do not edit notes/delays. Simulator QA required; evidence on PR only. No agent-handoff.md edits.
```
