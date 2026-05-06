# Agent handoff source of truth

Use this as the minimal continuity file between sessions.

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `docs/sdlc/mvp-ui-development-spec.md`
5. `docs/sdlc/ui-delivery-roadmap-and-spec.md`
6. `.cursor/rules/github-pr-issue-workflow.mdc`
7. `.github/pull_request_template.md`

## Session status snapshot

- Last updated: 2026-05-06 (America/Chicago)
- **Active issue:** [#222](https://github.com/collinbrowse/CrewCue/issues/222)
- **Active branch:** `feature/222-pace-checkpoint-parser`

## Current objective

Deliver end-to-end parser waypoint extraction/filtering/order updates plus Pace tab checkpoint/ETA editing UX, persist through existing course update API, and keep import/projection flows intact.

## Acceptance criteria (issue #222)

1. Parser (`packages/map-core/src/courseParse.ts`) extracts waypoint candidates from GPX/KML/JSON.
2. Filtering policy: if notable station-like naming exists, retain station-like markers only; else keep all candidates.
3. `start` and `finish` are accepted as station-like markers and are ordering anchors.
4. Anchor ordering: start first, finish last, remainder by course-progress distance.
5. Pace tab replaces placeholder with checkpoint list + ETA list anchored to user-entered start time, with checkpoint edit/save affordance.
6. Shared ETA helper reused from map dashboard and readouts to avoid duplicated math.
7. Tests expanded for parser + ETA helper; local `npm run verify` passes.

## Delivered (feature/222-pace-checkpoint-parser)

- `packages/map-core/src/courseParse.ts`: added JSON waypoint extraction, station-like filtering policy, start/finish anchor handling, progress-distance ordering, and waypoint selection integration in `buildRaceCourseFromGpx`.
- `packages/map-core/src/courseParse.test.ts`: added parser/ordering/filtering coverage for JSON point markers and station-like selection behavior.
- `apps/mobile/src/features/readouts/eta.ts`: new shared ETA math/format helper (`secondsForDistance`, `formatEtaClock`, `formatRemainingMinutes`).
- `apps/mobile/src/navigation/TrackMapDashboardScreen.tsx`: switched next-checkpoint ETA math to shared helper.
- `apps/mobile/src/navigation/AuthenticatedReadoutsScreen.tsx`: replaced placeholder with Pace UX:
  - start-time anchor input (`HH:MM`);
  - checkpoint editor (rename/reorder/remove/add);
  - save via `updateRaceCourse`;
  - ETA list derived from projection checkpoint distances and anchor start time.
- `apps/mobile/src/features/readouts/eta.test.ts` + `apps/mobile/package.json`: added ETA helper tests and wired into mobile test script.

## Next 1-3 tasks

1. Run manual mobile UX smoke (device/simulator): Pace edit/save flows and start-time ETA presentation.
2. Confirm behavior for newly added checkpoints with placeholder lat/lon in backend validation (if rejected, follow-up UI should request coordinates).
3. Open PR from `feature/222-pace-checkpoint-parser` to `main` with `Closes #222` once manual smoke is complete.

## Validation summary

- `npm test --workspace @crewcue/map-core` ✅
- `npm test --workspace @crewcue/mobile -- src/features/gpx/gpxImport.test.ts src/features/readouts/eta.test.ts` ✅
- `npm run verify` ✅

## Open risks/blockers/questions

- Pace “Add checkpoint” currently inserts placeholder coordinates (`0,0`) because existing edit surface does not yet capture lat/lon; backend acceptance may vary by validation rules.
- ETA list is currently keyed to projection checkpoint IDs; if user renames IDs and projection is stale, labels may reflect previous checkpoint IDs until projection refresh completes.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Do not commit real MapTiler/OSRM secrets.

## Successor prompt

```text
Continue #222 on branch feature/222-pace-checkpoint-parser. Run simulator/device smoke for Pace tab checkpoint editing and ETA anchoring. If add-checkpoint placeholder coordinates cause API rejection, implement coordinate capture UI (or block add until coords provided), rerun npm run verify, then prepare PR body with Closes #222.
```
