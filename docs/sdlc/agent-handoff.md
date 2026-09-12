# Agent handoff source of truth

Update at **PR/wave boundaries**, not every chat. Current state only.

## Snapshot

- Last updated: 2026-09-12 (UTC)
- **On `main`:** Pacing diagnosis + #475/#333 context; fallback climb work may still be in flight on feature branches.
- **Active feature line:** `feature/pacing-accuracy-program` (estimator wiring, backtest, model C1–C4, aid dwell) — prefer that branch’s commits/PR over this file for pacing detail until merged.
- **Process:** Always-on agent ceremony slimmed (#488) — fast path by default; handoff/issue/work-package/staging rules are opt-in or path-triggered.

## Next 1-3 tasks

1. Merge process slim-down (#488) when CI is green.
2. Land / merge pacing accuracy program PR(s) from `feature/pacing-accuracy-program`.
3. Single field validation via `npm run pacing:backtest` with a real-effort fixture after pacing PR merges.

## Blockers

- Auth0 still blocks unattended mobile simulator proof for estimator UI.
- Leave unrelated stashes alone (`wip-387-orphan`, `w2-3-local-wip-do-not-touch`, PR 296 fix, plus any `wip-pacing-*` stash).

## Successor prompt

```text
Prefer fast path: no mandatory SDLC triple-read. For pacing product work, checkout
feature/pacing-accuracy-program (or the open PR) and continue from its commits / PR body
Handoff delta — not from stale narrative here. After merge: real-effort backtest fixture.
```
