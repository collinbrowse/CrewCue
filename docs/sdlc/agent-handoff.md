# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-23 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete (W4-1/2/3 + W4-I).
- **Branch / PR:** `main` at `0df38b0` (W4-I #418 merged). Critical-bug re-audit on `cursor/critical-bug-investigation-d918` — no new PR.
- **Active next:** Residual — optionally Ready W3-2 (Strava) if secrets; else epic #360 closeout / residual triage.

## Completed

- Wave 0–3; W3-I (#406 / #409).
- W4-1 cutoff warnings (#408 / #410).
- W4-2 deterministic A-B bands on estimates (#411 / #415).
- W4-3 printable/shareable offline crew sheet (#412 / #414).
- W4-I integration smoke (#416): cutoff + bands + schedule baseline API; DEV crew-sheet export sim.
- W3-2 Strava OAuth deferred (optional / secrets).

## Next 1-3 tasks

1. Optionally Ready W3-2 (Strava) if staging secrets available.
2. Epic #360 closeout or residual backlog triage after W4-I merge.
3. Keep GET `/schedule` 503 / Auth0 Pace E2E blockers on the residual list (not Wave 4 scope).

## Open risks/blockers

- Critical bug re-audit (2026-08-23, pass 2): **one new live-trigger critical** — concurrent `POST .../manual-stop` (or ping + check-in) can lose a visit when overlapping `saveWs2RuntimeSnapshot` persists complete out of order (`raceRooms.ts:587-601`, `roomPersistence.ts:527-540`). Not covered by open #339 (hydrate single-flight). Wave 3/4 pacing/GPX/cutoff/crew-sheet authz OK; known drafts unchanged (#353–#342, #419, estimate ID/#420, projection 503).
- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.
- W3-2 Strava remains blocked on staging OAuth secrets.

## Successor prompt

```text
Wave 4 is complete after W4-I (#416) merges. Optionally Ready/execute W3-2 Strava if staging secrets exist; otherwise close or triage epic #360 residuals. Do not reopen Wave 4 feature scope.
```
