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
- **Roadmap phase:** Physiology micro-model + grade-cost blend on `main`; map banner loop fixed.
- **Branch / PR:** Local `main` matches `origin/main` (`b223c5a`). Feature branches deleted.
- **Active next:** Product-approve updated grade/blend constants; then staging soak.

## Completed

- PR #333 merged; #332 closed (quiet map auto-fetch; noticeBus post-dismiss dedupe).
- PR #476 merged; #475 closed (softer M(g) + cold/history grade-cost blends).
- Deleted local `fix/332-map-error-banner-loop` and `feature/micro-model-grade-cost-blend`.

## Next 1-3 tasks

1. Product-approve grade/blend constants in `services/api/src/lib/pacingEstimate/microModel/CONSTANTS_FOR_APPROVAL.md`.
2. Staging soak: course GPX blob → estimate via `roomId` → attach plan → ping remaining ETAs vs frozen plan.
3. Optional follow-up: mobile UI for `remainingCheckpointEtas` ahead/behind copy.

## Validation evidence

- PR #333 and #476 required checks were green before merge.

## Open risks/blockers

- Grade/blend knobs still need product re-approval after the field calibration.
- Auth0 still blocks unattended signed-in map smoke.
- Sparse checkpoint-only estimate path is degraded vs `roomId`+polyline.
- Unrelated leftover stashes remain; do not restore unless requested.

## Successor prompt

```text
Physiology micro-model, grade-cost blend, and map banner-loop fix are on main (PRs 453, 476, 333). Review CONSTANTS_FOR_APPROVAL.md, then staging-soak course GPX + remaining ETAs. Do not restore leftover stashes unless requested.
```
