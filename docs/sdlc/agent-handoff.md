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
- **Roadmap phase:** Crew schedule + AI pacing — Strava scope fix on `main` (#442); revoke-on-disconnect conflict resolution for #440.
- **Branch / PR:** [#440](https://github.com/collinbrowse/CrewCue/pull/440) on `feature/strava-deauthorize-on-disconnect` (merging `main` / #442).
- **Active next:** Push conflict fix, merge #440 when CI green, redeploy staging, Disconnect → Connect → Sync.

## Completed

- Wave 0–4; W3-2 Strava OAuth/sync.
- #442 merged: force consent, activity scope validation, 403 detail.
- #440: Disconnect calls Strava `POST /oauth/revoke` (best-effort) then clears local tokens — conflicts with #442 resolved in-branch.

## Next 1-3 tasks

1. Merge [#440](https://github.com/collinbrowse/CrewCue/pull/440) after CI green; redeploy staging.
2. Human: Disconnect → Connect (private activities checked) → Sync; fix Strava API **Website** if still Reframe.
3. Epic #360 residual triage.

## Validation evidence

- Conflict resolution: combined revoke mock + scope token fixtures in `stravaRoutes.test.ts`.
- Run Strava API tests after merge commit before claiming green.

## Open risks/blockers

- Staging must redeploy #442/#440 before live soak.
- Authed Pace E2E / schedule 503 remain on residual list.

## Successor prompt

```text
After #440 merges: redeploy staging, Disconnect/Connect Strava with private activities checked, confirm sync and that CrewCue leaves Strava authorized apps. Then triage epic #360 residuals.
```
