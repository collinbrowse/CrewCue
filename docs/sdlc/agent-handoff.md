# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-13 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 3 in progress (history ingest done; estimate next).
- **Branch / PR:** W3-1 [#396](https://github.com/collinbrowse/CrewCue/pull/396) merged (`Closes #393`). Postgres test isolation follow-up [#397](https://github.com/collinbrowse/CrewCue/pull/397).
- **Active next:** Execute W3-3 [#398](https://github.com/collinbrowse/CrewCue/issues/398) (`agent-ready`).

## Completed

- Wave 0–2; W2-I integration (#391 / #394).
- W3-1 GPX → durable `ActivityHistoryRef` ingest + list/get (#393 / #396).

## Next 1-3 tasks

1. Execute W3-3 #398 (deterministic pacing estimate from history + course).
2. Merge #397 if still open (activity history postgres test reset).
3. After W3-3: Ready W3-4 (wire estimate → schedule) and optionally W3-2 (Strava) / W3-5 (cold-start UX).

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.
- W3-1 `api-postgres-integration` failed until #397 truncates history between tests.

## Successor prompt

```text
Execute #398 (W3-3). Deterministic pacing estimate from ActivityHistoryRef + course. Fixture-seeded only — no live LLM in CI. PR Closes #398. Do not edit agent-handoff.md. Do not merge. Do not implement W3-4/W3-5/W3-2.
```
