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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete; W3-2 Strava merged (#431 / #433).
- **Branch / PR:** critical bug hunt on `cursor/critical-bug-investigation-8607` — Strava sync was ingesting non-run sports into pacing history.
- **Active next:** Merge Strava OAuth bounce #435; do not duplicate unmerged critical drafts.

## Completed

- W3-2 Strava OAuth + sync is on `main` (#431, staging connect fix #433).
- Bug hunt 2026-08-26: Strava `POST /strava/sync` imported Ride/Swim/etc. The estimator selects history by distance ratio only, so a distance-similar bike ride becomes the plan-of-record pace and crew ETAs can be hours early.

## Next 1-3 tasks

1. Merge #435 (Strava HTTPS callback → `crewcue://strava` bounce) after Railway redeploy soak.
2. Do not duplicate unmerged critical drafts: #353 (ping authz), #419 (course-change wipe), #427 (list cache clobber).
3. Epic #360 residual triage; GET `/schedule` 503 / Auth0 Pace E2E remain residual.

## Open risks/blockers

- Strava list endpoint has no sport filter; ingest must keep skipping non-runs.
- First-write-wins history: rides already synced before this fix stay until a later cleanup (out of scope).
- GET `/schedule` may 503 if projection hydrate fails.
- Live Strava Connect still needs staging secrets + #435 deploy for auto-close UX.

## Successor prompt

```text
After the Strava run-only ingest PR merges: do not reopen sport filtering. Next: merge/soak #435 OAuth bounce, or pick the next unmerged critical draft (#353 / #419 / #427). Do not duplicate those PRs.
```
