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
- **Roadmap phase:** Physiology micro-model pacing estimator (#451 / PR #453).
- **Branch / PR:** `feature/physiology-micro-model-estimator` → #453.
- **Active next:** Confirm CI green after merging `main`; do not merge until constants are approved.

## Completed

- Merged `origin/main` into #453 (handoff conflict resolved).
- Kept `etaFinishPlanIso` as anchored plan-pace finish; live remaining stays on `remainingCheckpointEtas`.
- Cold-start W4 estimate now sends `roomId` so band goldens use room route geometry.

## Next 1-3 tasks

1. Confirm GitHub CI is green on #453.
2. Product-approve constants in `microModel/CONSTANTS_FOR_APPROVAL.md`.
3. Staging soak for course GPX blob + remaining ETAs after merge.

## Validation evidence

- Memory-mode: `raceRoomProjection.test.ts`, `raceRoomSchedule.w4Integration.test.ts`, `pacingEstimateBands.test.ts`, related projection/pacing tests — pass.

## Open risks/blockers

- Numeric constants in `microModel/CONSTANTS_FOR_APPROVAL.md` need product approval before treating as final.
- Sparse checkpoint-only estimate path (no room route) is degraded vs roomId+polyline.

## Successor prompt

```text
On feature/physiology-micro-model-estimator / PR 453: confirm CI green after merging main, then review CONSTANTS_FOR_APPROVAL.md. Do not restore the calibration stash unless calibration work is requested.
```
