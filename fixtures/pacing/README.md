# Pacing / crew-schedule fixtures

Shared Wave 0 pack. Prefer these paths over one-off GPX/JSON in later PRs.

Units: distances in meters, durations in seconds, clock times ISO-8601 UTC (`…Z`).

The golden JSON is a pack `{ sheet, estimate, historyRefs }` — parse those nested objects with the W0-1 helpers; the file root is not a `CrewScheduleSheet`. Clock arrivals equal `raceStartAt + elapsedSeconds` (planned dwell is after arrival and does not shift later clocks in this golden).

| File | Purpose |
| --- | --- |
| `course-50k-with-aids.gpx` | Course + aid waypoints |
| `activity-long-trail.gpx` | Athlete history sample |
| `activity-short-road.gpx` | Dissimilar history (model should not overfit) |
| `corrupt.gpx` | Parse failure |
| `empty.gpx` | Empty track |
| `schedule-expected.json` | Golden schedule for course+plan |
| `strava-activity-summary.json` | Mock Strava payload (no live API) |
| `load.ts` | Fixture path list + GPX inspect / JSON load helpers (`package.json` marks this folder ESM) |
