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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 3 feature packages complete; Wave 3 integration next.
- **Branch / PR:** W3-4 [#404](https://github.com/collinbrowse/CrewCue/pull/404) and W3-5 [#405](https://github.com/collinbrowse/CrewCue/pull/405) merged (`Closes #401`, `Closes #402`).
- **Active next:** Execute W3-I [#406](https://github.com/collinbrowse/CrewCue/issues/406).

## Completed

- Wave 0–2; W2-I (#391 / #394).
- W3-1 GPX history ingest (#393 / #396); W3-3 deterministic estimates (#398 / #400).
- W3-4 estimate → schedule plan of record (#401 / #404).
- W3-5 cold-start UX + `crewcue://dev/cold-start` (#402 / #405).
- W3-2 Strava OAuth deferred (optional / secrets).

## Next 1-3 tasks

1. Execute W3-I #406 (history → estimate → schedule + cold-start smoke; unlock Wave 4).
2. After W3-I: Ready+implement W4-1 (cutoff warnings).
3. Optionally Ready W3-2 (Strava) if staging secrets available.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.

## Successor prompt

```text
Execute #406 (W3-I). Prove history → estimate → schedule attach + DEV cold-start smoke. Update agent-handoff.md. File/mark W4-1 agent-ready. PR with Closes #406. Do not implement Wave 4 features.
```
