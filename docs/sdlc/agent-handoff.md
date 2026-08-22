# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-22 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 4 complete; residual triage / regression hardening.
- **Branch / PR:** Coverage automation on `cursor/missing-test-coverage-8cb3`; PR pending automation open. No linked issue available in this run because `gh` is read-only here.
- **Active next:** Continue residual triage / targeted regression coverage; optionally Ready W3-2 (Strava) if secrets become available.

## Completed

- Wave 0–3; W3-I (#406 / #409).
- W4-1 cutoff warnings (#408 / #410).
- W4-2 deterministic A-B bands on estimates (#411 / #415).
- W4-3 printable/shareable offline crew sheet (#412 / #414).
- W4-I integration smoke (#416): cutoff + bands + schedule baseline API; DEV crew-sheet export sim.
- W3-2 Strava OAuth deferred (optional / secrets).
- Coverage automation (2026-08-22): added API route regression coverage proving GPX activity-history idempotency keeps the first row immutable for changed same-athlete `externalId` replays and scopes the same `externalId` independently across athletes.

## Next 1-3 tasks

1. Continue targeted regression coverage on recent merged API/client changes with production-code-only or edge-case gaps.
2. Optionally Ready W3-2 (Strava) if staging OAuth secrets become available.
3. Epic #360 closeout or residual backlog triage; keep Auth0 Pace E2E blockers visible.

## Open risks/blockers

- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.
- XcodeBuildMCP MCP `tap` may be unavailable; bundled AXe CLI works for sim QA.
- W3-2 Strava remains blocked on staging OAuth secrets.
- GitHub issue creation is unavailable to this automation because `gh` is read-only and no issue MCP tool is configured.

## Validation evidence

- `npm ci` (dependencies were absent initially; install completed, with existing audit warnings).
- `npm run build -w @crewcue/api && PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/routes/activityHistory.test.js`.
- `npm run test:memory -w @crewcue/api`.
- `npm run verify`.

## Successor prompt

```text
Continue residual triage / regression hardening after the GPX activity-history idempotency coverage PR merges. Prioritize recent production diffs with untested parsing, idempotency, permissions, or data-validation behavior; avoid reopening Wave 4 feature scope.
```
