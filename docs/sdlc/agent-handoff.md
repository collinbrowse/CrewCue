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
- **Roadmap phase:** Physiology micro-model pacing estimator (#451).
- **Branch / PR:** `feature/physiology-micro-model-estimator` (issue #451; PR not opened yet).
- **Active next:** Commit/push; open PR with constants approval note; `npm run verify` already green locally.

## Completed

- #451 implementation on branch: dwell→stoppage rename; micro-model estimator + 3 scenario bands; roomId/course GPX; attach writes `baselineTrack`; live remaining ETAs on ping/visit.

## Next 1-3 tasks

1. Commit + `gh pr create` with `Closes #451` and constants approval section.
2. Staging soak for course GPX blob + projection remaining ETAs after merge.
3. Optional follow-up: mobile UI for `remainingCheckpointEtas` ahead/behind copy.

## Validation evidence

- `npm run verify` exit 0 (local).
- Micro-model unit tests + pacing band tests updated for scenario re-sims.

## Open risks/blockers

- Numeric constants in `microModel/CONSTANTS_FOR_APPROVAL.md` need product approval before treating as final.
- Sparse checkpoint-only estimate path (no room route) is degraded vs roomId+polyline.

## Successor prompt

```text
On feature/physiology-micro-model-estimator: review CONSTANTS_FOR_APPROVAL.md, commit if needed, open PR Closes #451, merge after CI green, redeploy staging API.
```
