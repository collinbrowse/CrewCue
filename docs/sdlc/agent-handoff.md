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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 2 complete; Wave 3 next (W3-1 history ingest).
- **Branch / PR:** W2-I `feature/391-w2-integration` (Closes #391) — open, do not merge until review.
- **Active next:** Execute W3-1 [#393](https://github.com/collinbrowse/CrewCue/issues/393) (`agent-ready`).

## Completed

- Wave 0–1; W2-1 check-in → reproject schedule ETAs (#383 / #385).
- W2-2 notify on material (≥60s) later-ETA shift via chat push stack (#386 / #389).
- W2-3 mobile closed check-in → manual-stop → schedule refresh; DEV `crewcue://dev/schedule-sheet` + sample 8-min control (#387 / #390).
- W2-I integration: API smoke check-in → ETA shift + notify mocks; DEV mobile check-in proof; handoff unlock Wave 3 (#391).

## Next 1-3 tasks

1. Execute W3-1 #393 (ingest past GPX → stored `ActivityHistoryRef` history).
2. After W3-1: Ready+implement W3-3 (pacing estimate) — keep Wave 3 packages serialized with schedule path conflicts as noted in the program doc.
3. Optionally Ready W3-2 (Strava OAuth) in parallel with W3-1 if secrets/staging env available.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.

## Successor prompt

```text
Execute #393 (W3-1). Ingest past GPX → stored ActivityHistoryRef. Prefer fixtures/pacing/*. Cover EC matrix. Do not implement W3-2+. PR with Closes #393. Run npm run verify.
```
