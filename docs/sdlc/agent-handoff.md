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
- **Roadmap phase:** Pacing prediction accuracy (`docs/sdlc/pacing-accuracy-program.md`). #475, #478, #333 merged.
- **Branch / PR:** `feature/pacing-accuracy-program` → single PR closing #481–#484 (PR A–D combined per owner directive to speed delivery).
- **Active next:** Get the PR green in CI and merged; then the one field validation (see below).

## Completed (this branch — PR A–D as logical commits, one PR)

- **PR A (#481) — connect history to the plan.** `apps/mobile/src/api/client.ts` gains `createPacingEstimate` + `attachPacingEstimate`; `CrewScheduleSheetScreen` auto-creates+attaches by `pacingEstimateId` (so `baselineTrack` reaches `course.baselineTrack`) and adds a "Recalculate from my history" control. Server derives `plannedPaceSecondsPerKm` from the estimate on attach (Trap 2), so the PACE badge/ETA stop using the 6:00/km GPX fallback.
- **PR B (#482) — offline backtest harness.** `services/api/src/lib/pacingEstimate/backtest.ts` + `npm run pacing:backtest` (CLI) print predicted vs actual per aid + finish with MAE over `fixtures/pacing/backtest-*.json`. Deterministic, no HTTP/DB.
- **PR C (#483) — one coherent model change.** C1 flat-equivalent GAP from history distance+gain (4.0 m/m); C2 Riegel endurance scaling (k=0.19); C3 fatigue renormalized to shape-only (does not inflate finish); C4 restored full physiological `M(g)` at grade-cost blend 1.0 (un-bent #475). Re-approved `CONSTANTS_FOR_APPROVAL.md`. Golden `estimate-bands.json` regenerated via `scripts/regen-estimate-bands.ts`.
- **PR D (#484) — aid dwell realism.** Default checkpoint stop 600s→120s (still editable via stop plans); `selectAidCheckpoints` fallback now only emits ETAs for checkpoints with a planned stop; new additive `ScheduleStop.movingElapsedSeconds` splits moving vs cumulative dwell on the schedule row (server + contract + mobile row + DEV fixture).

## Next 1-3 tasks

1. Merge the PR once CI is green (PR body must include `Closes #481` … `Closes #484`).
2. **Single field validation** (only after PR D, per program policy): run one real completed effort through `npm run pacing:backtest` (add a `fixtures/pacing/backtest-*.json` from real splits) and compare finish/aid MAE; tune `GAIN_FLAT_EQUIVALENT_METERS_PER_METER` / `RIEGEL_ENDURANCE_PACE_EXPONENT` against evidence, not by feel.
3. Simulator proof of the mobile estimator wiring + moving/dwell row once the Auth0 blocker (#333 follow-up) or a deeplink/fixture path is available.

## Validation evidence

- `npm run verify` (root, full CI parity) passes: contracts/map-core/platform-client builds, lint incl dual-client guard, typecheck, tests (mobile 193, api 321, contracts 19, map-core 42, platform-client 20 — 0 fail), `smoke:mobile:startup`, and final build (incl `expo export` + web build).
- Backtest MAE on the synthetic 50k example improved 0:14:59 → 0:08:52 (synthetic actuals; not a field result).

## Open risks/blockers

- **Model constants are provisional.** C1/C2 factors and the restored `M(g)` are calibrated offline only; they need the single real-effort backtest before being trusted. The hist fixture's extreme 4568 m gain makes C1 produce a very fast flat-equivalent GAP — sanity-check against a realistic effort.
- **Altitude sign is pre-existing and untouched.** `altitudeFactor < 1` currently makes duration *shorter* at altitude (physiologically backwards); left as-is (out of C1–C4 scope). Fix in a separate issue if desired.
- Auth0 (#333) blocks unattended mobile simulator proof of the PR A row + PR D moving/dwell row.
- `buildDerivedMetricsFromPolyline` uses a per-vertex 3 m gain threshold (understates gain on dense tracks) — do not copy into `buildPlanBaselineFromModel`.
- Three unrelated stashes exist (`wip-387-orphan`, `w2-3-local-wip-do-not-touch`, PR 296 fix). Leave them alone.

## Successor prompt

```text
Branch feature/pacing-accuracy-program implements PR A–D of docs/sdlc/pacing-accuracy-program.md
as logical commits under one PR (Closes #481–#484); npm run verify is green. Next: after merge,
do the single field validation — add a fixtures/pacing/backtest-<real>.json from a real completed
effort, run npm run pacing:backtest, and tune GAIN_FLAT_EQUIVALENT_METERS_PER_METER and
RIEGEL_ENDURANCE_PACE_EXPONENT against that evidence (recompute expectations from inputs, do not
bless golden numbers). Do not restore leftover stashes.
```
