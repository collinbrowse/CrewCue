# Pacing / crew-schedule fixtures

Shared Wave 0 pack. Prefer these paths over one-off GPX/JSON in later PRs.

Units: distances in meters, durations in seconds, clock times ISO-8601 UTC (`…Z`).

The golden JSON is a pack `{ sheet, estimate, historyRefs }` — parse those nested objects with the W0-1 helpers; the file root is not a `CrewScheduleSheet`. Clock arrivals equal `raceStartAt + elapsedSeconds` (planned stoppage is after arrival and does not shift later clocks in this golden).

| File | Purpose |
| --- | --- |
| `course-50k-with-aids.gpx` | Course + aid waypoints |
| `activity-long-trail.gpx` | Athlete history sample |
| `activity-short-road.gpx` | Dissimilar history (model should not overfit) |
| `corrupt.gpx` | Parse failure |
| `empty.gpx` | Empty track |
| `schedule-expected.json` | Golden schedule for course+plan |
| `estimate-cold-start.json` | Cold-start (`coldStart: true`) estimate + coarse sheet for mobile DEV UX |
| `estimate-bands.json` | W4-2 three-band golden (history-backed + cold-start) + spread policy |
| `cutoff-compare.json` | W4-1 cutoff modes + UTC race-day wall-clock policy notes for schedule warnings |
| `strava-activity-summary.json` | Mock Strava payload (no live API) |
| `load.ts` | Fixture path list + GPX inspect / JSON load helpers (`package.json` marks this folder ESM) |

### Confidence / A-B bands

Bands come from **three deterministic micro-model scenario re-sims** (see `services/api/src/lib/pacingEstimate/microModel/CONSTANTS_FOR_APPROVAL.md`), not fixed finish-time multipliers:

- `expected` — nominal GAP / fatigue / altitude
- `conservative` — slower GAP + higher fatigue/altitude knobs
- `aggressive` — faster GAP + lower fatigue/altitude knobs
- Ordering: conservative ≥ expected ≥ aggressive (elapsed)
- Cold-start uses GAP **10:00/mi** with the same scenario knobs
- Schedule plan-of-record / moving-time uses **expected** only; bands are informational

### Cutoff / `time_of_day` policy (W4-1)

Schedule projection resolves `RaceCourseCheckpoint.cutoff` `time_of_day` against the **UTC calendar date** of `raceStartAt` (`YYYY-MM-DD` + `hour:minute:00.000Z`). No venue timezone is applied. Status bands use `CUTOFF_WARN_MARGIN_SECONDS` (900): `ok` when margin > 900s, `warn` when `0 < margin ≤ 900`, `breach` when margin ≤ 0. Omit warning fields when cutoff is absent.
