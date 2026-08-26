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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete; scheduled regression-coverage hardening in progress.
- **Branch / PR:** `cursor/missing-test-coverage-02ff` — PR pending for Strava OAuth redirect coverage.
- **Active next:** Review/merge the Strava redirect coverage PR, then continue residual epic #360 closeout / backlog triage.

## Completed

- Wave 0–3; W3-I (#406 / #409).
- W4-1 cutoff warnings (#408 / #410).
- W4-2 deterministic A-B bands on estimates (#411 / #415).
- W4-3 printable/shareable offline crew sheet (#412 / #414).
- W4-I integration smoke (#416): cutoff + bands + schedule baseline API; DEV crew-sheet export sim.
- W3-2 Strava OAuth/activity sync landed (#431) plus staging callback fix (#433).
- Coverage pass: added Strava OAuth HTTPS redirect route tests for public success page and escaped provider error HTML.

## Next 1-3 tasks

1. Review/merge the Strava OAuth redirect coverage PR.
2. Epic #360 closeout or residual backlog triage.
3. Keep GET `/schedule` 503 / Auth0 Pace E2E blockers on the residual list.

## Validation evidence

- `npm run test:memory -w @crewcue/api` — pass (270 tests, 266 pass, 0 fail; 4 skipped).
- `npm run verify` — pass (dual-client guard, lint/typecheck/tests/smoke/build).

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.
- Strava staging/live validation still depends on real OAuth secrets and a usable test account.

## Successor prompt

```text
Continue after the Strava redirect coverage PR: review CI, merge if green, then triage epic #360 residuals without reopening Wave 4 feature scope.
```
