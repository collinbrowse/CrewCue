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
- **Roadmap phase:** Crew schedule + AI pacing — activity GPX upload (#443) in progress.
- **Branch / PR:** `feature/activity-history-gpx-upload` → open PR for #443.
- **Active next:** Merge #443; staging soak Strava revoke (#440) if still pending.

## Completed

- Wave 0–4; W3-2 Strava OAuth/sync; #442/#440 on `main`.
- #443 impl: mobile `ingestActivityHistoryGpx` / `listActivityHistory`, Profile Upload GPX card, cold-start copy.

## Next 1-3 tasks

1. Review/merge PR for #443.
2. Redeploy staging API; Strava Disconnect → Connect → Sync soak (#440/#442).
3. Epic #360 residual triage.

## Validation evidence

- `npm run verify` green on feature branch.
- Simulator: Profile Upload activity GPX card + Choose GPX opens Files picker (OCR); full fixture select blocked by AXe/tap tooling.

## Open risks/blockers

- Agent Files-picker file selection needs better UI automation (AXe SimulatorKit arch / MCP tap missing).
- Staging Strava soak still needs Railway redeploy confirmation.

## Successor prompt

```text
Review/merge PR for #443 (mobile activity GPX upload into shared history). Then confirm Railway staging redeploy after #440/#442 and soak Strava Disconnect/Connect/Sync.
```
