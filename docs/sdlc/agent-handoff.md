# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-20 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete on `main`; residual hardening / coverage.
- **Branch / PR:** Coverage [#423](https://github.com/collinbrowse/CrewCue/pull/423) on `cursor/missing-test-coverage-6ce4` — open.
- **Active acceptance:** Cover one meaningful recent regression risk with deterministic tests, avoid duplicate open coverage PRs, run relevant validation.

## Completed

- API coverage PR #423: `GET /race-rooms/:roomId/schedule` now has regression coverage for projection hydrate failure returning 503 instead of stale plan-only schedule.
- Added a resettable test-only schedule projection loader seam in `raceRoomSchedule.ts`; production default remains `getProjectionViewForRoom`.
- Validation passed: focused schedule route test, full API memory suite, and root `npm run verify`.

## Next 1-3 tasks

1. Review/merge open residual PRs as appropriate: #419 bugfix, #420-#423 coverage.
2. Continue coverage automation on non-conflicting API gaps (e.g. estimate + check-in + cutoff triple-stack, or notify-after-estimate attach).
3. Epic #360 closeout / residual backlog triage; Ready W3-2 Strava only if staging OAuth secrets exist.

## Open risks/blockers

- Several coverage/bugfix PRs are open concurrently; avoid overlapping `raceRoomSchedule*` edits until merge order is clear.
- Automation has read-only `gh` guidance and no issue-creation MCP tool, so #423 has no linked issue.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- W3-2 Strava remains blocked on staging OAuth secrets.

## Successor prompt

```text
After #423, continue residual coverage only on non-conflicting API gaps. First check open PR paths (#419-#423), then choose one high-risk untested branch and run scoped tests plus `npm run verify`.
```
