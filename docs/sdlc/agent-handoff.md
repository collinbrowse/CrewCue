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
- **Roadmap phase:** Crew schedule + AI pacing — upload UX on PR #446; CI flake #450.
- **Branch / PR:** `feature/activity-gpx-upload-status` → https://github.com/collinbrowse/CrewCue/pull/446
- **Active next:** Land #450 (`test:pg --test-concurrency=1`); merge #446; redeploy staging API.

## Completed

- #443/#444: activity GPX upload.
- #445/#447: upload progress, duplicate skip, next-step + Open Pace.
- #450 (in progress): serialize `test:pg` to stop shared-TRUNCATE flakes.

## Next 1-3 tasks

1. Confirm `api-postgres-integration` green after concurrency=1.
2. Merge PR #446 (Closes #445 #447 #450).
3. Redeploy staging API for metrics ingest.

## Validation evidence

- CI flake: EC6 404 / EC7 400 from parallel TRUNCATE of `activity_history_json`.
- Fix: `node --test --test-concurrency=1` in `services/api` `test:pg`.

## Open risks/blockers

- Staging must be redeployed for `POST /activity-history` metrics route.

## Successor prompt

```text
Confirm PR #446 api-postgres-integration is green after test:pg concurrency=1; merge; redeploy staging API.
```
