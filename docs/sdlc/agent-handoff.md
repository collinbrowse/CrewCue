# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-27 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — merging bot backlog (#427/#426/#428).
- **Branch / PR:** `cursor/critical-bug-investigation-bd45` → https://github.com/collinbrowse/CrewCue/pull/427
- **Active next:** Merge #427 (list-cache clobber fix); then #426 cutoff tests; then #428 estimator tests; confirm CI on `main`.

## Completed

- #443/#444/#446/#448/#449 on `main`.
- #427 (in progress): do not clobber live room cache when listing rooms.

## Next 1-3 tasks

1. Land #427, then #426, then #428 (rebase each onto updated `main`).
2. Confirm `main` CI green (`checks`, `dual-client-guard`, `api-postgres-integration`).
3. Redeploy staging API; smoke GPX upload + Strava soak.

## Validation evidence

- #427: stop-plan notes survive concurrent `GET /race-rooms/mine` hydrate.

## Open risks/blockers

- Staging may still need Railway redeploy for latest API.

## Successor prompt

```text
After #427/#426/#428 are on main, confirm CI green. Redeploy staging API and smoke Profile GPX upload → Open Pace.
```
