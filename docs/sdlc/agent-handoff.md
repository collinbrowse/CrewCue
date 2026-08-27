# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-27 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — #444/#446/#448 on `main`.
- **Branch / PR:** `cursor/missing-test-coverage-1792` → https://github.com/collinbrowse/CrewCue/pull/449
- **Active next:** Merge #449 (course-update idempotency coverage); redeploy staging API; Strava soak.

## Completed

- #443/#444: activity GPX upload.
- #445/#447/#450 via #446: upload progress UX + serial `test:pg`.
- #448: activity GPX prefers `<trkpt>` over planned `<rte>` (pace poison fix).
- #449 (in progress): course PUT idempotency release/replay regression test.

## Next 1-3 tasks

1. Merge PR #449 after CI green.
2. Redeploy staging API (metrics ingest + GPX parse fix).
3. Staging soak: GPX upload → Open Pace; Strava Disconnect → Connect → Sync.

## Validation evidence

- #446/#448 merged to `main` (`32b0541`, `6b2f139`).
- #449: route-level course idempotency release test + conflict resolve with main.

## Open risks/blockers

- Staging may still need Railway redeploy for latest API.

## Successor prompt

```text
Merge PR #449 if CI green. Redeploy staging API from main. Smoke Profile GPX upload → Open Pace and Strava reconnect against staging.
```
