# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-12 (UTC)
- **Roadmap phase:** Pacing prediction accuracy (`docs/sdlc/pacing-accuracy-program.md`). #475, #478, #333 merged.
- **Branch / PR:** `feature/pacing-accuracy-program` → PR #485 (Closes #481–#484) + #487 follow-ups.
- **Active next:** Push/update PR #485 with #487 commits; merge when green.

## Completed (this session)

- **#487 — history upload did not change splits.** Root cause: schedule auto-estimated once and stuck (often cold-start). Fix: `estimateRecompute.ts` + schedule auto-recompute when usable history changes / cold-start now has history. Commit `a00759f`.
- **#487 Pace lag — calendar updates, Pace tab does not.** Root cause: attach updated room baseline/pace but never refreshed the **stored projection** Pace reads (`plannedElapsedSecondsAtCross`). Schedule rebuilds from the estimate on every GET, so it looked correct. Fix: `refreshProjectionAfterPlanOfRecordChange` after attach + regression test in `raceRoomSchedule.estimateWire.test.ts`.

## Next 1-3 tasks

1. Push branch and update PR #485 body with `Closes #487` (and keep #481–#484).
2. After merge: single field validation per pacing-accuracy-program (real backtest fixture).
3. Auth0 / deeplink path for unattended simulator proof of history → Pace clocks.

## Validation evidence

- Mobile: `estimateRecompute` 11/11 + full mobile suite green (prior commit).
- API: `raceRoomSchedule.estimateWire.test.js` 15/15 incl. new “attach refreshes projection” test.
- Did not re-run full root `npm run verify` this turn (scoped API build+test only).

## Open risks/blockers

- Unattended iOS sim still blocked on Auth0 + Files picker for end-to-end GPX→Pace.
- Model constants still provisional pending real-effort backtest.
- Three unrelated stashes — leave alone.

## Successor prompt

```text
On feature/pacing-accuracy-program: #487 fixed (auto-recompute on history change +
projection refresh on estimate attach so Pace matches schedule). Push and update PR #485
with Closes #487; confirm CI green. Then field validation after merge.
```
