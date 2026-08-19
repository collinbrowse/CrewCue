# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-19 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete; residual coverage hardening in progress.
- **Branch / PR:** Coverage automation branch `cursor/missing-test-coverage-f3b7`; PR pending from this branch. No linked issue was created because this automation environment has read-only `gh` and no issue-creation MCP.
- **Active next:** Residual — optionally Ready W3-2 (Strava) if secrets; else epic #360 closeout / residual triage.

## Completed

- Wave 0–3; W3-I (#406 / #409).
- W4-1 cutoff warnings (#408 / #410).
- W4-2 deterministic A-B bands on estimates (#411 / #415).
- W4-3 printable/shareable offline crew sheet (#412 / #414).
- W4-I integration smoke (#416): cutoff + bands + schedule baseline API; DEV crew-sheet export sim.
- Coverage hardening: `POST /pacing-estimates` now tests explicit `historyRefIds` scoping (cross-athlete IDs) and missing-ID 404 behavior.
- W3-2 Strava OAuth deferred (optional / secrets).

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
- Coverage automation issue creation remains blocked by tool policy (read-only `gh`; no issue MCP).
- Validation 2026-08-19: `npm run test:memory -w @crewcue/api` and `npm run verify` passed after `npm ci`.

## Successor prompt

```text
Wave 4 is complete; continue residual triage. If running coverage automation, inspect recent merged production code for high-risk untested branches, prefer API/shared deterministic tests, and avoid reopening feature scope.
```
