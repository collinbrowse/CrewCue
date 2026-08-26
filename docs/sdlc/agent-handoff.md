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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete; Strava disconnect deauthorize shipping.
- **Branch / PR:** [#440](https://github.com/collinbrowse/CrewCue/pull/440) on `feature/strava-deauthorize-on-disconnect` — Closes [#439](https://github.com/collinbrowse/CrewCue/issues/439).
- **Active next:** Merge #440 after CI green; fix Strava API **Website** field; optional `approval_prompt=force` follow-up.

## Completed

- Wave 0–4 (incl. W4-I #418).
- W3-2 Strava OAuth + sync (#431), staging connect (#433), deep-link bounce (#435).
- Implemented: `DELETE /strava/connection` calls Strava `POST /oauth/revoke` (best-effort) then clears local tokens; unit tests; runbook Website + disconnect notes.

## Next 1-3 tasks

1. Merge [#440](https://github.com/collinbrowse/CrewCue/pull/440) (Strava revoke on disconnect).
2. In Strava API settings, set **Website** to CrewCue (not Reframe GitHub) so consent UI is correct.
3. Epic #360 residual triage; optional follow-up: `approval_prompt=force` + validate granted scopes.

## Validation evidence

- `npm run test:memory -w @crewcue/api` — pass (279 tests, 275 pass, 0 fail; 4 skipped), including deauthorize client + disconnect revoke-best-effort tests.

## Open risks/blockers

- Agent shell lacked `gh` (resolved — #439 / #440 filed).
- Live Strava soak still needs staging secrets + redeploy after merge.
- Prior 403 sync may need reconnect with activity scopes after revoke lands.

## Successor prompt

```text
After #440 merges: redeploy staging, Disconnect then Connect Strava, confirm sync and that CrewCue leaves Strava authorized apps. Fix Website field on Strava API settings. Then triage epic #360 residuals.
```
