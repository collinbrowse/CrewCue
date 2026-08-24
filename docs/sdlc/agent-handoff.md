# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-24 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete (W4-1/2/3 + W4-I).
- **Branch / PR:** Coverage automation [#428](https://github.com/collinbrowse/CrewCue/pull/428) on `cursor/missing-test-coverage-ba94`; no issue created because this environment has read-only `gh`.
- **Active next:** Review/merge the coverage PR if CI is green; then continue residual triage (optional W3-2 Strava if secrets, else epic #360 closeout).

## Completed

- Wave 0–3; W3-I (#406 / #409).
- W4-1 cutoff warnings (#408 / #410).
- W4-2 deterministic A-B bands on estimates (#411 / #415).
- W4-3 printable/shareable offline crew sheet (#412 / #414).
- W4-I integration smoke (#416): cutoff + bands + schedule baseline API; DEV crew-sheet export sim.
- W3-2 Strava OAuth deferred (optional / secrets).
- Coverage automation (2026-08-24): strengthened deterministic estimator tests for invalid UTC race-start validation and all-dissimilar usable history staying history-backed with parseable bands.

## Next 1-3 tasks

1. Review/merge coverage automation PR after CI.
2. Optionally Ready W3-2 (Strava) if staging secrets available.
3. Epic #360 closeout or residual backlog triage; keep GET `/schedule` 503 / Auth0 Pace E2E blockers on the residual list.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.
- W3-2 Strava remains blocked on staging OAuth secrets.
- GitHub issue creation was not performed for this coverage automation run because `gh` is read-only and no issue-creation MCP tool is available.
- Validation evidence: focused deterministic estimator test passed; `npm run test:memory -w @crewcue/api` passed; `npm run verify` passed.

## Successor prompt

```text
Review/merge the 2026-08-24 coverage automation PR if CI is green. Then continue residual triage: optionally Ready/execute W3-2 Strava if staging secrets exist; otherwise close or triage epic #360 residuals. Do not reopen Wave 4 feature scope.
```
