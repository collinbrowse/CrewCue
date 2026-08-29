# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-29 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — regression coverage follow-up on `main`.
- **Branch / PR:** `cursor/missing-test-coverage-ec94` / PR #461.
- **Active next:** Review/merge metrics-only activity-history coverage; then confirm CI green and continue staging soak tasks.

## Completed

- #427: list rooms no longer clobbers live room cache.
- #426: cutoff warning regression coverage.
- #428: pacing estimator validation edges.
- CI: `checks` job now runs on `main` push (was skipped when PR-only guard skipped).
- Coverage automation: metrics-only `POST /activity-history` now covers changed-value idempotent replay and same-`externalId` athlete scoping.

## Next 1-3 tasks

1. Merge coverage PR after CI is green.
2. Confirm tip-of-`main` CI green (`checks`, `dual-client-guard`, `api-postgres-integration`).
3. Redeploy staging API; smoke Profile GPX upload → Open Pace and Strava reconnect.

## Validation evidence

- Merged: #427 (`811453c`), #426 (`d794a52`), #428 (`db3d43b`).
- Local: `npm run test -w @crewcue/api` passed (287 tests: 283 pass, 4 skipped).
- Local: `npm run verify` passed.

## Open risks/blockers

- Staging may still need Railway redeploy.
- This automation environment has no safe issue-creation tool; PR body should note no linked issue was created.

## Successor prompt

```text
After coverage PR merge, confirm tip-of-main CI green. Redeploy staging API and smoke GPX upload → Open Pace against staging.
```
