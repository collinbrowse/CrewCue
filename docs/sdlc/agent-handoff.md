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
- **Roadmap phase:** Pace UX (#456); GPX progress (#454 / PR #455) still open; micro-model stash pending.
- **Branch / PR:** `feature/pace-time-remaining-from-race-start` → #456.
- **Active next:** Open/merge PR for #456; then #455 / physiology stash.

## Completed

- #456: Pace aid **Time remaining** uses elapsed from race start (not now→ETA countdown).

## Next 1-3 tasks

1. Merge PR for #456 after CI green.
2. Merge #455 (GPX progress bar) if still open.
3. Restore micro-model calibration stash on physiology branch.

## Validation evidence

- Timeline unit test for `paceTimeRemainingFromRaceStartLabel`.
- Sim Pace: CP2 Est. arrival 6:54 AM, race start 6:00 AM, Time remaining **54m** (matches start→aid, not wall clock 2:58).

## Open risks/blockers

- XcodeBuildMCP `tap` still unavailable; deeplink + screenshot used for Pace proof.

## Successor prompt

```text
Merge PRs for #456 and #455. Then restore stash on feature/physiology-micro-model-estimator for calibration.
```
