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
- **Roadmap phase:** Crew schedule + AI pacing — #444 merged; upload status UX (#445) in progress.
- **Branch / PR:** `feature/activity-gpx-upload-status` for #445.
- **Active next:** Merge #445; redeploy staging API for metrics ingest; soak upload + Strava.

## Completed

- #443/#444: activity GPX upload (metrics path + Profile card).
- #445 in progress: staged progress copy (reading/parsing/uploading).

## Next 1-3 tasks

1. Merge #445 (upload progress status).
2. Redeploy staging API; verify GPX upload end-to-end.
3. Epic #360 residual / Strava soak if still open.

## Validation evidence

- #444 on `main` (`60f8ea3`).
- #445: unit tests for `formatActivityUploadProgress`.

## Open risks/blockers

- Staging must be redeployed for `POST /activity-history` metrics route.
- Files-picker agent automation still limited.

## Successor prompt

```text
Merge PR for #445 if open. Redeploy staging API, reload mobile from main, upload a timed GPX and confirm progress stages then history count updates.
```
