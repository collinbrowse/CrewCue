# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-01 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — post-backlog coverage hardening on `main`.
- **Branch / PR:** `cursor/missing-test-coverage-9d01` / PR #464.
- **Active next:** Merge Strava route coverage; redeploy staging; soak.

## Completed

- #427: list rooms no longer clobbers live room cache.
- #426: cutoff warning regression coverage.
- #428: pacing estimator validation edges.
- CI: `checks` job now runs on `main` push (was skipped when PR-only guard skipped).
- Coverage automation: Strava routes now have regression tests for paginated sync persistence, activity-permission 403 surfacing, disconnect cleanup when revoke throws, and disconnect cleanup when config is absent.

## Next 1-3 tasks

1. Review/merge the Strava route coverage PR.
2. Redeploy staging API.
3. Smoke Profile GPX upload → Open Pace; Strava reconnect.

## Validation evidence

- `npm run test:memory -w @crewcue/api` — pass (287 pass / 4 skipped).
- `npm run verify` — pass.

## Open risks/blockers

- Staging may still need Railway redeploy.
- No GitHub issue was created for this automation run because this environment documents `gh` as read-only and has no issue-creation MCP tool.

## Successor prompt

```text
Review/merge the Strava route coverage PR. Then redeploy staging API and smoke GPX upload → Open Pace plus Strava reconnect against staging.
```
