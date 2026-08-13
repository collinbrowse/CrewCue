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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 in progress (W4-1 done; W4-2 + W4-3 next).
- **Branch / PR:** W4-1 [#410](https://github.com/collinbrowse/CrewCue/pull/410) merged (`Closes #408`).
- **Active next:** Parallel W4-2 [#411](https://github.com/collinbrowse/CrewCue/issues/411) and W4-3 [#412](https://github.com/collinbrowse/CrewCue/issues/412).

## Completed

- Wave 0–3; W3-I (#406 / #409).
- W4-1 cutoff warnings on schedule projection (`cutoffStatus` / `cutoffMarginSeconds`; UTC race-day wall clock for `time_of_day`) (#408 / #410).
- W3-2 Strava OAuth deferred (optional / secrets).

## Next 1-3 tasks

1. Execute W4-2 #411 (confidence / A-B bands) — prefer API-only.
2. Execute W4-3 #412 (printable / shareable offline crew sheet) in parallel — owns mobile export.
3. After both: W4-I full race-day smoke; optionally Ready W3-2 if secrets available.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.
- W4-2 vs W4-3: avoid simultaneous long-lived edits under `apps/mobile/**/schedule*`.

## Successor prompt

```text
Execute #411 (W4-2 bands) and/or #412 (W4-3 printable crew sheet) in parallel. Respect path conflict map. Do not edit agent-handoff.md. Do not merge your own PRs. Do not implement W4-I.
```
