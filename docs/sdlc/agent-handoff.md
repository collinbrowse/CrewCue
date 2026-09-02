# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-02 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing - coverage hardening on `main`.
- **Branch / PR:** `cursor/missing-test-coverage-map-core-async-route-gpx` (PR pending automation publish).
- **Active next:** Review/merge async route-only activity GPX coverage; then continue CI/staging smoke.

## Completed

- Coverage automation: `parseGpxActivityTrackAsync` now has route-only namespaced GPX regression coverage with waypoint scanning disabled.
- CI: `checks` job runs on `main` push (was skipped when PR-only guard skipped).

## Next 1-3 tasks

1. Review/merge the map-core async route-only GPX coverage PR.
2. Confirm tip-of-`main` CI green (`checks`, `dual-client-guard`, `api-postgres-integration`).
3. Redeploy staging API; smoke Profile GPX upload -> Open Pace and Strava reconnect.

## Validation evidence

- `npm run test -w @crewcue/map-core` pass.
- `npm run verify` pass.

## Open risks/blockers

- Staging may still need Railway redeploy.
- No linked GitHub issue was created because this automation environment has read-only `gh` guidance and no issue-creation MCP tool.

## Successor prompt

```text
Review/merge the map-core async route-only GPX coverage PR. Then confirm main CI, redeploy staging API, and smoke GPX upload -> Open Pace plus Strava reconnect.
```
