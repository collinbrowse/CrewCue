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
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete (W4-1/2/3 + W4-I merged as #418).
- **Branch / PR:** Critical bug hunt — list cache clobber can roll back stop-plan writes.
- **Active next:** Residual — optionally Ready W3-2 (Strava) if secrets; else epic #360 closeout / residual triage. Merge unmerged critical drafts (#353, #419) independently.

## Completed

- Wave 0–3; W3-I (#406 / #409).
- W4-1 cutoff warnings (#408 / #410).
- W4-2 deterministic A-B bands on estimates (#411 / #415).
- W4-3 printable/shareable offline crew sheet (#412 / #414).
- W4-I integration smoke (#416): cutoff + bands + schedule baseline API; DEV crew-sheet export sim.
- W3-2 Strava OAuth deferred (optional / secrets).
- 2026-08-24 bug hunt: GET `/race-rooms/mine` no longer clobbers a newer in-memory room write (stop-plan data loss).

## Next 1-3 tasks

1. Optionally Ready W3-2 (Strava) if staging secrets available.
2. Epic #360 closeout or residual backlog triage after W4-I merge.
3. Merge unmerged critical drafts: ping authz #353, no-ping check-in wipe #419.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.
- W3-2 Strava remains blocked on staging OAuth secrets.

## Successor prompt

```text
Wave 4 is complete after W4-I (#416) merges. Optionally Ready/execute W3-2 Strava if staging secrets exist; otherwise close or triage epic #360 residuals. Do not reopen Wave 4 feature scope.
```
