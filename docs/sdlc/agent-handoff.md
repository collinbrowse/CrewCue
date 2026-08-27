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
- **Roadmap phase:** Crew schedule + AI pacing — landing bot backlog.
- **Branch / PR:** `cursor/missing-test-coverage-a4b5` → https://github.com/collinbrowse/CrewCue/pull/426
- **Active next:** Merge #426 cutoff tests; then #428 estimator tests; confirm CI on `main`.

## Completed

- #427 on `main`: list rooms no longer clobbers live room cache.
- #426 (in progress): cutoff warning regression coverage.

## Next 1-3 tasks

1. Land #426, then #428.
2. Confirm `main` CI green.
3. Redeploy staging API; smoke GPX + Strava.

## Validation evidence

- #427 merged (`811453c`).

## Open risks/blockers

- Staging may still need Railway redeploy.

## Successor prompt

```text
Merge #428 after #426. Confirm main CI green, then redeploy staging.
```
