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
- **Roadmap phase:** Physiology micro-model is on `main` (#451 / PR #453 merged).
- **Branch / PR:** Local `main` matches `origin/main` (`129ca36`). Feature branch deleted.
- **Active next:** Product-approve micro-model constants; then staging soak.

## Completed

- PR #453 merged; #451 closed.
- Deleted local and remote `feature/physiology-micro-model-estimator`.

## Next 1-3 tasks

1. Product-approve constants in `services/api/src/lib/pacingEstimate/microModel/CONSTANTS_FOR_APPROVAL.md`.
2. Staging soak: course GPX blob → estimate via `roomId` → attach plan → ping remaining ETAs vs frozen plan.
3. Optional follow-up: mobile UI for `remainingCheckpointEtas` ahead/behind copy.

## Validation evidence

- PR #453 required checks were green before merge (`pr-decision-doc-guard`, `dual-client-guard`, `checks`, `api-postgres-integration`).

## Open risks/blockers

- Numeric constants still need product approval before treating as final.
- Local stash `wip: micro-model calibration` remains; do not restore unless calibration work is requested.
- Sparse checkpoint-only estimate path (no room route) is degraded vs `roomId`+polyline.

## Successor prompt

```text
Physiology micro-model is on main (PR 453 merged). Review CONSTANTS_FOR_APPROVAL.md for product approval, then staging-soak course GPX + remaining ETAs. Do not restore stash "wip: micro-model calibration" unless calibration is requested.
```
