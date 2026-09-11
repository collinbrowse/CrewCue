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
- **Roadmap phase:** Micro-model grade-cost calibration (#475) plus map banner loop (#333).
- **Branch / PR:** `feature/micro-model-grade-cost-blend` → #475.
- **Active next:** Open/merge calibration PR; merge #333 when CI green.

## Completed

- Restored stash `wip: micro-model calibration` onto a new branch from `main`.
- Merged `main` into #333 (handoff conflict only).

## Next 1-3 tasks

1. Land #475 (grade-cost blend) after tests/CI.
2. Merge #333 when CI green (Auth0 still blocks signed-in map smoke).
3. Product-approve updated grade/blend constants, then staging soak.

## Validation evidence

- #333: platform-client tests + mobile typecheck after merge of `main`.
- #475: apply tests next (`microModel.test.ts`, band goldens).

## Open risks/blockers

- Grade/blend constants need product re-approval after this calibration.
- Auth0 blocks unattended sim proof for #333.
- Sparse checkpoint-only estimate path is degraded vs `roomId`+polyline.

## Successor prompt

```text
Land PR for #475 (micro-model grade-cost blend) and merge #333 when CI green. Do not restore leftover stashes unless explicitly requested.
```
