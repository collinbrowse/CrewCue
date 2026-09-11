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
- **Active next:** Merge origin/main into #453; get CI green; do not merge until constants are approved.

## Completed

- #451 implementation on branch: dwell→stoppage rename; micro-model estimator + 3 scenario bands; roomId/course GPX; attach writes `baselineTrack`; live remaining ETAs on ping/visit.
- Pace UX (#456) and GPX progress (#455) are on `main`.

## Next 1-3 tasks

1. Finish merge of `main` into #453 and restore CI.
2. Product-approve constants in `microModel/CONSTANTS_FOR_APPROVAL.md`.
3. Staging soak for course GPX blob + remaining ETAs after merge.

## Validation evidence

- `npm run verify` was green locally before the merge.
- Micro-model unit tests + pacing band tests updated for scenario re-sims.

## Open risks/blockers

- Numeric constants in `microModel/CONSTANTS_FOR_APPROVAL.md` need product approval before treating as final.
- Sparse checkpoint-only estimate path (no room route) is degraded vs roomId+polyline.

## Successor prompt

```text
On feature/physiology-micro-model-estimator / PR 453: confirm CI green after merging main, then review CONSTANTS_FOR_APPROVAL.md. Do not restore the calibration stash unless calibration work is requested.
```
