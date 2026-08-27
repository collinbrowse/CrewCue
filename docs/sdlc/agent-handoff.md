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
- **Roadmap phase:** Crew schedule + AI pacing — post-#443 coverage hardening.
- **Branch / PR:** `cursor/missing-test-coverage-1792` → coverage PR pending/open for scheduled automation.
- **Active next:** Review/merge coverage PR; merge #443 if still open; staging soak Strava revoke (#440) if still pending.

## Completed

- Wave 0–4; W3-2 Strava OAuth/sync; #442/#440 on `main`.
- #443 impl: mobile `ingestActivityHistoryGpx` / `listActivityHistory`, Profile Upload GPX card, cold-start copy.
- Scheduled coverage hardening: API course-update idempotency release/replay regression test; mobile activity GPX test path type fix so full verify passes.

## Next 1-3 tasks

1. Review/merge scheduled coverage PR.
2. Review/merge PR for #443 if still pending.
3. Redeploy staging API; Strava Disconnect → Connect → Sync soak (#440/#442).

## Validation evidence

- `npm run verify` green on feature branch.
- Simulator: Profile Upload activity GPX card + Choose GPX opens Files picker (OCR); full fixture select blocked by AXe/tap tooling.
- `npm run test:memory -w @crewcue/api` green (280 pass, 4 skip).
- `npm run lint -w @crewcue/mobile` green.
- `npm run verify` green.

## Open risks/blockers

- Agent Files-picker file selection needs better UI automation (AXe SimulatorKit arch / MCP tap missing).
- Staging Strava soak still needs Railway redeploy confirmation.
- No mobile UI behavior changed in coverage PR; simulator not re-run for test-only type fix.

## Successor prompt

```text
Review/merge scheduled coverage PR for course-update idempotency release coverage. Then continue #443 merge/staging Strava soak tasks from the roadmap.
```
