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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 3 in progress (estimate done; wire + cold-start next).
- **Branch / PR:** W3-3 [#400](https://github.com/collinbrowse/CrewCue/pull/400) merged (`Closes #398`).
- **Active next:** Parallel W3-4 [#401](https://github.com/collinbrowse/CrewCue/issues/401) (schedule wire) and W3-5 [#402](https://github.com/collinbrowse/CrewCue/issues/402) (cold-start UX).

## Completed

- Wave 0–2; W2-I integration (#391 / #394).
- W3-1 GPX → durable `ActivityHistoryRef` ingest + list/get (#393 / #396); postgres test isolation (#397).
- W3-3 deterministic `POST /pacing-estimates` from history + course (#398 / #400).

## Next 1-3 tasks

1. Execute W3-4 #401 (wire estimate → schedule plan of record).
2. Execute W3-5 #402 (cold-start UX) in parallel.
3. After both: W3-I integration; optionally Ready W3-2 (Strava) if secrets available.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.

## Successor prompt

```text
Execute #401 (W3-4 schedule wire) and/or #402 (W3-5 cold-start UX) in parallel. Do not edit agent-handoff.md. Do not merge your own PRs. Do not implement W3-2.
```
