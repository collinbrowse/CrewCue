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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 2 feature packages complete; Wave 2 integration next.
- **Branch / PR:** W2-2 [#389](https://github.com/collinbrowse/CrewCue/pull/389) and W2-3 [#390](https://github.com/collinbrowse/CrewCue/pull/390) merged (`Closes #386`, `Closes #387`).
- **Active:** Execute W2-I [#391](https://github.com/collinbrowse/CrewCue/issues/391).

## Completed

- Wave 0–1; W2-1 check-in → reproject schedule ETAs (#383 / #385).
- W2-2 notify on material (≥60s) later-ETA shift via chat push stack (#386 / #389).
- W2-3 mobile closed check-in → manual-stop → schedule refresh; DEV `crewcue://dev/schedule-sheet` + sample 8-min control (#387 / #390).

## Next 1-3 tasks

1. Execute W2-I #391 (integration: check-in moves ETA; crew sees update; handoff → Wave 3).
2. After W2-I: Ready+implement W3-1 (history ingest) per program DAG.
3. Keep Wave 3 packages serialized with schedule path conflicts as noted in the program doc.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.

## Successor prompt

```text
Execute #391 (W2-I). Prove API check-in → ETA shift (+ notify mocks) and DEV mobile check-in smoke. Update agent-handoff.md. File/mark W3-1 agent-ready. PR with Closes #391. Do not implement Wave 3 features.
```
