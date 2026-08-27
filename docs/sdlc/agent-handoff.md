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
- **Roadmap phase:** Crew schedule + AI pacing — bot backlog #427/#426/#428 on `main`.
- **Branch / PR:** `main` (`db3d43b` + CI fix PR).
- **Active next:** Confirm CI green after checks-on-push fix; redeploy staging; soak.

## Completed

- #427: list rooms no longer clobbers live room cache.
- #426: cutoff warning regression coverage.
- #428: pacing estimator validation edges.
- CI: `checks` job now runs on `main` push (was skipped when PR-only guard skipped).

## Next 1-3 tasks

1. Confirm tip-of-`main` CI green (`checks`, `dual-client-guard`, `api-postgres-integration`).
2. Redeploy staging API.
3. Smoke Profile GPX upload → Open Pace; Strava reconnect.

## Validation evidence

- Merged: #427 (`811453c`), #426 (`d794a52`), #428 (`db3d43b`).

## Open risks/blockers

- Staging may still need Railway redeploy.

## Successor prompt

```text
Confirm tip-of-main CI green. Redeploy staging API. Smoke GPX upload → Open Pace against staging.
```
