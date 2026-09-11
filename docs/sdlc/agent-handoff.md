# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-11 (UTC)
- **Roadmap phase:** Unblock PR #333 (map error-banner loop), then micro-model calibration.
- **Branch / PR:** `fix/332-map-error-banner-loop` → #333 (`Closes #332`).
- **Active next:** Merge #333 when CI green; apply calibration stash on a new branch from `main`.

## Completed

- Merged `origin/main` into #333 (handoff conflict resolved). Banner fix still present: roomId-only effect, quiet auto-fetch, noticeBus post-dismiss dedupe.
- Physiology micro-model is on `main` (#451 / PR #453).

## Next 1-3 tasks

1. Merge #333 when CI green (signed-in map smoke still Auth0-blocked).
2. Apply stash `wip: micro-model calibration` onto a new branch from `main` (grade-cost blend; first-aid ~44 min late).
3. Staging soak: course GPX blob → estimate via `roomId` → remaining ETAs vs frozen plan.

## Validation evidence

- PR #453 required checks were green before merge.
- #333 previously green on 2026-07-22; needs a fresh run after this merge.

## Open risks/blockers

- Auth0 blocks unattended sim proof for #333 banner absence.
- Calibration stash changes numeric constants that still need product approval.
- Sparse checkpoint-only estimate path is degraded vs `roomId`+polyline.

## Successor prompt

```text
Merge PR 333 when CI green. Then restore stash "wip: micro-model calibration" onto a new branch from main (do not reuse the deleted physiology branch). Review CONSTANTS_FOR_APPROVAL.md after applying.
```
