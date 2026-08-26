# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-26 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete; W3-2 Strava on `main` (#431 / #433 / #435).
- **Branch / PR:** [#436](https://github.com/collinbrowse/CrewCue/pull/436) expanding for [#438](https://github.com/collinbrowse/CrewCue/issues/438) — run-only ingest + last-year sync + Profile copy.
- **Active next:** Finish #436/#438, then epic #360 residual triage.

## Completed

- Wave 0–4 (incl. W4-I #418).
- W3-2 Strava OAuth + sync (#431), staging connect (#433), deep-link bounce (#435).
- #437 redirect coverage merged into the bounce path.

## Next 1-3 tasks

1. Land #436 / #438: sport filter, last-year paginated sync, Profile copy.
2. Epic #360 closeout or residual backlog triage.
3. Keep GET `/schedule` 503 / Auth0 Pace E2E blockers on the residual list.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- First-write-wins history: non-run rows synced before sport filter stay until a later cleanup.
- Live Strava soak still needs staging secrets + redeploy after #436.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.

## Successor prompt

```text
After #436/#438 merges: redeploy staging, Connect Strava, confirm sync covers ~1y of runs only and Profile copy matches. Then triage epic #360 residuals. Do not reopen OAuth bounce (#435) unless soak finds a bug.
```
