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
- **Roadmap phase:** Pacing prediction accuracy. #475 and #333 are merged.
- **Branch / PR:** `feature/478-fallback-gain-penalty` → #478.
- **Active next:** Land #478, then wire the mobile client to the pacing estimator.

## Completed

- **Diagnosed why predictions were wrong, with database evidence.** `pacingEstimateId` is NULL on every race room and `pacing_estimate_json` is empty, so no micro-model estimate has ever been generated or attached. No client calls `POST /pacing-estimates`. Every schedule shown to date came from the fallback: the hardcoded 6:00/km `DEFAULT_PACE_SECONDS_PER_KM` (planned course GPX has no timestamps) plus `buildPlanBaselineFromModel`. Uploaded Strava and GPX history has never influenced any number the racer sees.
- **Retracted the #475 calibration note.** The "first aid ~44 min late" observation was attributed to micro-model terrain double-counting, but the micro-model was not running. The real cause was the fallback's 8 s/m climb penalty. The softened `M(g)` and history blend 0.22 are therefore unvalidated.
- #478: fallback climb penalty 8 -> 3.6 s/m, plus a test pinning the magnitude.

## Next 1-3 tasks

1. Land #478.
2. Wire `createPacingEstimate` + `attachPacingEstimate` into `apps/mobile/src/api/client.ts` so history reaches the plan. Attach **by `pacingEstimateId`**, not inline estimate: only the stored-id path carries `baselineTrack` into `course.baselineTrack` (`raceRoomSchedule.ts` ~447-459). Also derive `plannedPaceSecondsPerKm` from the estimate, or the PACE badge keeps reading 9:39.
3. Offline backtest harness over `fixtures/pacing/` printing predicted vs actual per aid and finish with MAE, so model tuning stops costing a real race.

## Validation evidence

- #478: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run smoke:mobile:startup`, dual-client guard all pass. 42 map-core tests pass including the new penalty assertion.
- `npm run build` fails locally in `@crewcue/web` only, on a missing `@rolldown/binding-darwin-arm64` native module (npm optional-dependency bug). Reproduced on clean `main`, so it is pre-existing and environmental, not from this change. `tsc -b` passes.

## Open risks/blockers

- Grade/blend constants need revert plus re-derivation against a harness, then product re-approval.
- Auth0 blocks unattended sim proof; expect it to block simulator verification of the mobile estimator wiring.
- `buildDerivedMetricsFromPolyline` computes course gain with a **per-vertex** 3 m threshold, which likely understates gain on dense tracks. Verify before deriving bulk GAP from stored `elevationGainMeters`.
- Local `vite build` stays broken until `node_modules` is reinstalled; do not mistake it for a regression.
- Three unrelated stashes exist (`wip-387-orphan`, `w2-3-local-wip-do-not-touch`, PR 296 fix). Leave them alone.

## Successor prompt

```text
Land #478 (fallback climb penalty 8 -> 3.6 s/m) when CI is green. Then implement the next task:
add createPacingEstimate and attachPacingEstimate to apps/mobile/src/api/client.ts so uploaded
history actually drives the race plan. Attach by pacingEstimateId (not an inline estimate body),
and derive plannedPaceSecondsPerKm from the estimate. Do not restore leftover stashes.
```
