# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-14 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete (W4-I [#418](https://github.com/collinbrowse/CrewCue/pull/418) merged).
- **Branch / PR:** critical bug hunt on `cursor/critical-bug-investigation-f530` — preserve closed check-ins across course-shape writes when no GPS ping exists.
- **Active next:** Merge the check-in preservation fix; then residual W3-2 / epic #360 triage.

## Completed

- Wave 0–4 packages as of 2026-08-13.
- Identified: POST waypoint / PUT course deleted projection when `lastAccepted` was null, wiping manual check-ins and reverting GET `/schedule` ETAs.

## Next 1-3 tasks

1. Land check-in preservation on course-shape writes (this branch).
2. Optionally Ready W3-2 (Strava) if staging secrets available.
3. Epic #360 closeout or residual backlog triage.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- Top unmerged prior critical drafts remain #353 (ping authz), then #344 / #342.

## Successor prompt

```text
Wave 4 is merged. Land or verify the check-in-vs-course-shape preservation fix, then optionally Ready W3-2 Strava if staging secrets exist; otherwise triage epic #360 residuals.
```
