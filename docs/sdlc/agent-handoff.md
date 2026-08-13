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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 3 complete; Wave 4 next.
- **Branch / PR:** W3-I `feature/406-w3-integration` (open PR `Closes #406`).
- **Active next:** Execute W4-1 [#408](https://github.com/collinbrowse/CrewCue/issues/408) (`agent-ready`).

## Completed

- Wave 0–2; W2-I (#391 / #394).
- Wave 3: W3-1 history ingest, W3-3 estimates, W3-4 plan-of-record, W3-5 cold-start UX.
- W3-I (#406): API E2E history → estimate → schedule; DEV cold-start smoke; Wave 4 unlock.
- W3-2 Strava OAuth deferred (optional / secrets).

## Next 1-3 tasks

1. Execute W4-1 #408 (cutoff warnings on schedule / projection).
2. Ready W4-2 (confidence / A-B bands) after W4-1 path stable.
3. Optionally Ready W3-2 (Strava) if staging secrets available.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.

## Successor prompt

```text
Execute #408 (W4-1). Cutoff warnings on schedule projection (on/under/over). Additive contracts only. Cover every edge-case row. PR with Closes #408. Do not edit agent-handoff.md. Do not merge. Do not implement W4-2/W4-3.
```
