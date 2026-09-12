# Agent handoff source of truth

Update at **PR/wave boundaries**, not every chat. Current state only.

## Snapshot

- Last updated: 2026-09-12 (UTC)
- **Roadmap phase:** Pacing prediction accuracy (`docs/sdlc/pacing-accuracy-program.md`).
- **Branch / PR:** `main` @ `e5695c1` (PR #485 merged — Closes #481–#484, #487).
- **Active next:** Single field validation (real backtest fixture); then Auth0-free Pace sim proof if needed.

## Completed (merged)

- PR A–D pacing accuracy program + #487: history auto-recompute on schedule; projection refresh on estimate attach so Pace matches calendar.
- Local cleanup: deleted `feature/pacing-accuracy-program`, `docs/480-pacing-accuracy-program`, `feature/478-fallback-gain-penalty` (remote pruned).

## Next 1-3 tasks

1. **Single field validation:** add `fixtures/pacing/backtest-<real>.json` from a completed effort, run `npm run pacing:backtest`, tune C1/C2 constants against evidence.
2. Confirm on staging/device: recalculate from history → Pace tab clocks match schedule.
3. Unattended sim proof for Pace/history still needs Auth0 bypass or deeplink (see `feature/agent-harness-gates` if that lands).

## Validation evidence

- PR #485 CI green at merge; #487 wire test “attach refreshes projection…” + `estimateRecompute` unit tests.

## Blockers

- Model constants provisional until real-effort backtest.
- Unattended iOS Auth0 still blocks full GPX→Pace sim without deeplink/fixture.
- Three unrelated stashes — leave alone (`wip-387-orphan`, `w2-3-local-wip-do-not-touch`, PR 296 fix).

## Successor prompt

```text
PR #485 is on main. Next: single field validation — add fixtures/pacing/backtest-<real>.json
from a real completed effort, npm run pacing:backtest, tune GAIN_FLAT_EQUIVALENT and
RIEGEL_ENDURANCE against evidence. Leave unrelated stashes alone.
```
