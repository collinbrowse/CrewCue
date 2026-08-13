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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 1 complete; Wave 2 unlocked.
- **Branch / PR:** W1-I [#381](https://github.com/collinbrowse/CrewCue/issues/381) on `feature/381-w1-integration` (open PR; do not merge until staff review).
- **Active next:** Execute W2-1 [#383](https://github.com/collinbrowse/CrewCue/issues/383) after W1-I merges.

## Completed

- Wave 0 unlock; W1-1…W1-5; W1-I schedule E2E (API seed→delay→clear + DEV mobile edit smoke).
- W2-1 Ready + `agent-ready`: [#383](https://github.com/collinbrowse/CrewCue/issues/383).

## Next 1-3 tasks

1. Staff-merge W1-I PR for #381.
2. Execute W2-1 #383 (check-in arrival/departure → reproject future ETAs).
3. Then file/Ready W2-2 / W2-3 per program DAG.

## Open risks/blockers

- XcodeBuildMCP `snapshot_ui` can fail (AXe SimulatorKit arch); bundled `axe` CLI still works for describe/tap/type.
- Authed Pace E2E still needs a test account (DEV deeplink remains Auth0-free proof path).
- Strava OAuth / AI model port still need staging secrets design in W3.

## Successor prompt

```text
After #381 merges: execute W2-1 #383. Check-in arrival/departure must reproject future GET /schedule ETAs. Cover EC matrix. API golden + conflict proofs. No handoff.md edits. PR Closes #383. Do not merge. Do not implement W2-2/W2-3.
```
