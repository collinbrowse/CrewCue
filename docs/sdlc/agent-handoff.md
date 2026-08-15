# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-15 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete; current work is coverage hardening for recent Wave 3/4 schedule behavior.
- **Branch / PR:** `cursor/missing-test-coverage-6cfe` — coverage PR to be opened by automation. No linked issue was supplied; this cloud run has read-only `gh` and no issue-creation MCP tool.
- **Active next:** Residual — optionally Ready W3-2 (Strava) if secrets; else epic #360 closeout / residual triage.

## Completed

- Wave 0–3; W3-I (#406 / #409).
- W4-1 cutoff warnings (#408 / #410).
- W4-2 deterministic A-B bands on estimates (#411 / #415).
- W4-3 printable/shareable offline crew sheet (#412 / #414).
- W4-I integration smoke (#416): cutoff + bands + schedule baseline API; DEV crew-sheet export sim.
- Coverage hardening (2026-08-15): estimate-backed schedule interpolation now covers unanchored checkpoints between aid ETA anchors, dwell stacking through those checkpoints, and farthest-checkpoint-as-finish fallback when no `finish` id exists.
- W3-2 Strava OAuth deferred (optional / secrets).

## Next 1-3 tasks

1. Optionally Ready W3-2 (Strava) if staging secrets available.
2. Epic #360 closeout or residual backlog triage after W4-I merge.
3. Keep GET `/schedule` 503 / Auth0 Pace E2E blockers on the residual list; future coverage pass can target schedule hydrate-failure behavior if still weak.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.
- W3-2 Strava remains blocked on staging OAuth secrets.
- Coverage PR validation: `npm run test:memory -w @crewcue/api` passed; `npm run verify` passed. Initial test run required `npm ci` because `tsc` was not installed.

## Successor prompt

```text
Wave 4 is complete. Review/merge the coverage PR for estimate-backed schedule interpolation if CI is green; then optionally Ready/execute W3-2 Strava if staging secrets exist, otherwise close or triage epic #360 residuals.
```
