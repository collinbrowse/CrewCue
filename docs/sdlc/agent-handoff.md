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
- **Branch / PR:** `cursor/missing-test-coverage-ba94` → https://github.com/collinbrowse/CrewCue/pull/428
- **Active next:** Merge #428; confirm CI on `main`.

## Completed

- #427 on `main`: list rooms no longer clobbers live room cache.
- #426 on `main`: cutoff warning regression coverage.
- #428 (in progress): pacing estimator validation edges.

## Next 1-3 tasks

1. Land #428.
2. Confirm `main` CI green (`checks`, `dual-client-guard`, `api-postgres-integration`).
3. Redeploy staging API; smoke GPX + Strava.

## Validation evidence

- #427 merged (`811453c`); #426 merged (`d794a52`).

## Open risks/blockers

- Staging may still need Railway redeploy.

## Successor prompt

```text
Confirm main CI green after #427/#426/#428. Redeploy staging API and smoke Profile GPX upload → Open Pace.
```
