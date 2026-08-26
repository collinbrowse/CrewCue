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
- **Roadmap phase:** Crew schedule + AI pacing — #444 merged; upload status UX (#445) + next-step (#447) on PR #446.
- **Branch / PR:** `feature/activity-gpx-upload-status` → https://github.com/collinbrowse/CrewCue/pull/446
- **Active next:** Commit/push next-step UX; sim QA; merge #446; redeploy staging API.

## Completed

- #443/#444: activity GPX upload (metrics path + Profile card).
- #445: staged progress; duplicate skip-before-parse; single overall %.
- #447 (in progress): next-step hint + Open Pace when historyCount > 0.

## Next 1-3 tasks

1. Finish #447 on PR #446 (verify Open Pace on sim; push).
2. Merge #445/#447 PR; redeploy staging API for metrics ingest.
3. Epic #360 residual / Strava soak if still open.

## Validation evidence

- Unit: `activityHistoryNextStepHint`, upload progress formatters.
- Sim: pending for Open Pace CTA visibility.

## Open risks/blockers

- Staging must be redeployed for `POST /activity-history` metrics route.
- Files-picker agent automation still limited.

## Successor prompt

```text
On feature/activity-gpx-upload-status: confirm Profile shows next-step + Open Pace when history > 0; commit/push; update PR #446 with Closes #445 and Closes #447; merge after CI green; redeploy staging API.
```
