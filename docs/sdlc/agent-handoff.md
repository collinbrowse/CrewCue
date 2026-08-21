# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-21 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete (W4-1/2/3 + W4-I).
- **Branch / PR:** Coverage automation [#424](https://github.com/collinbrowse/CrewCue/pull/424) on `cursor/missing-test-coverage-92a9`. No issue was created because this environment documents `gh` as read-only and no issue-creation MCP tool is available.
- **Active next:** Residual — optionally Ready W3-2 (Strava) if secrets; else epic #360 closeout / residual triage.

## Completed

- Wave 0–3; W3-I (#406 / #409).
- W4-1 cutoff warnings (#408 / #410).
- W4-2 deterministic A-B bands on estimates (#411 / #415).
- W4-3 printable/shareable offline crew sheet (#412 / #414).
- W4-I integration smoke (#416): cutoff + bands + schedule baseline API; DEV crew-sheet export sim.
- W3-2 Strava OAuth deferred (optional / secrets).
- Coverage automation: added API regression coverage for GPX activity history idempotent replay with changed GPX content under the same `externalId`, including per-athlete scoping of that provider/upload id.

## Next 1-3 tasks

1. Optionally Ready W3-2 (Strava) if staging secrets available.
2. Epic #360 closeout or residual backlog triage after W4-I merge.
3. Keep GET `/schedule` 503 / Auth0 Pace E2E blockers on the residual list (not Wave 4 scope).

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.
- W3-2 Strava remains blocked on staging OAuth secrets.
- Current coverage automation validation passed: `npm run test:memory -w @crewcue/api`; `npm run verify`. Initial test attempt failed before dependency install because `tsc` was missing; `npm ci` resolved it.

## Successor prompt

```text
Coverage automation added GPX activity-history idempotent replay/scoping tests on `cursor/missing-test-coverage-92a9`. Next coverage run should inspect recent merged production paths and avoid duplicating activity-history replay, cutoff, pacing-estimate, and schedule-projection coverage already listed here.
```
