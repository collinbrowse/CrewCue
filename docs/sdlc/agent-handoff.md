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
- **Roadmap phase:** Crew schedule + AI pacing — Strava sync 403 scope fix in flight.
- **Branch / PR:** [#442](https://github.com/collinbrowse/CrewCue/pull/442) on `feature/441-strava-scope-force-validate` — Closes [#441](https://github.com/collinbrowse/CrewCue/issues/441); related revoke [#440](https://github.com/collinbrowse/CrewCue/pull/440).
- **Active next:** Merge/redeploy #442 (+ #440), then Disconnect → Connect → Sync with private activities checked.

## Completed

- Wave 0–4; W3-2 Strava OAuth/sync on main.
- #441 implementation: force consent, `read,activity:read_all`, scope validation, redirect scope bounce, Strava 403 detail.

## Next 1-3 tasks

1. Merge/redeploy [#442](https://github.com/collinbrowse/CrewCue/pull/442) and [#440](https://github.com/collinbrowse/CrewCue/pull/440).
2. Human: Strava API **Website** field; Disconnect → Connect → Sync on staging.
3. Epic #360 residual triage.

## Validation evidence

- `npm run test:memory -w @crewcue/api` — pass (0 fail).
- `npm test -w @crewcue/mobile` — pass (0 fail).

## Open risks/blockers

- Live 403 persists until staging has this build; existing weak tokens need reconnect.
- Authed Pace E2E / schedule 503 remain on residual list.

## Successor prompt

```text
Merge #441 and #440, redeploy staging, then Disconnect/Connect Strava with private activities checked and confirm sync. If 403 remains, read the new error detail (activity:read_permission) and check Railway logs.
```
