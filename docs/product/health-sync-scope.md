# Health sync scope: Apple Health and Health Connect

Status: **parked Nov 24 2026.** COROS sends no GPS routes to Apple Health (tested on a real phone), and Garmin very likely doesn't either. The model needs full tracks. Replaced by [run-import-and-grade-curve-scope.md](run-import-and-grade-curve-scope.md).

## Goal

Runners get their past runs into CrewCue without exporting files. Garmin, COROS, Suunto, Polar, Apple Watch and Strava can all write workouts to Apple Health (iOS) and Health Connect (Android). CrewCue reads them from there, with no partner API approval and no vendor fees. Direct Garmin and COROS APIs stay deferred ([pricing-and-v1-scope.md](pricing-and-v1-scope.md)).

## Product decisions

| Topic | Decision |
|---|---|
| Which runs | Every running or trail-running workout with a GPS route from the last 12 months, pulled automatically. The estimator already keeps only runs of a similar distance. The runner can remove a run in Settings. |
| Ongoing sync | Fetch new runs whenever the runner opens the app. No background sync. Setup tells the runner this up front. |
| Estimate updates | New runs recompute the finish estimate for each of the runner's races that starts more than 7 days from now. The runner gets a note with old → new finish. |
| Freeze | Starting 7 days before the race, new runs are stored but don't change that race's estimate. |
| Crew notice | A system line in the race chat. No push. |
| Entry points | Two same-weight buttons, "Connect Apple Health" (Android: "Connect Health Connect") and "Import a file", on both the onboarding Training history step and Settings > Past runs. |
| Denied access or no routes | Explain and offer a file import. Keep the connection so later runs still sync. |
| Who is asked | Runners only. Crew members are never asked for health access. |
| Permission scope | Read-only: workouts and workout routes. CrewCue never writes to Health. |

## UX

### Onboarding: Training history step

The lead and tips change. Existing Skip behavior is unchanged.

- Lead: "CrewCue learns your pace from your past runs so your finish and aid station times fit how you run."
- Buttons (same weight): **Connect Apple Health** · **Import a file**. Skip stays.
- Tip under the buttons: "Connected runs keep syncing when you open CrewCue, so your estimate keeps sharpening until race week. Works with any sports watch that syncs their data with Apple Health/ Health Connect" (each platform shows its own store's name).
- After connecting, a short progress state ("Reading your runs…"), then "Found 23 runs from the last year" with source names ("Garmin Connect, COROS"), then the projection teaser.
- No usable runs: "Your watch may not share routes with GPS data. Import your training history using GPX files, or skip this step for now" The Import a file button stays. The connection is kept.
- Access denied: "CrewCue can't read your workouts. Allow it in Settings > Health > Data Access, or import a file." Includes a button that opens system Settings.

### Settings > Past runs

- Connected row: "Apple Health · synced 2 h ago", with Disconnect. Disconnect stops syncing and keeps runs already imported. Separately, each run can be removed.
- Not connected: the same two buttons as onboarding.
- Run list: date, distance, time, climb, and a source label (Garmin Connect / COROS / File). Swipe or menu to Remove (needs a new API).

### Estimate update note

- Runner, as a banner on the race at next open: "Finish estimate updated from 2 new runs: 27h 40m → 27h 15m."
- Crew, as a system line in race chat: "Finish estimate updated: 27h 40m → 27h 15m."
- Durations read in hours and minutes (`27h 40m`; under an hour, `45m`).
- Inside 7 days of the start: no update and no note. Runs are still stored for the next race.

## Technical shape

- **Client reads, server parses.** client-core defines the sync logic (window, dedupe, last-sync anchor). The platform apps own the HealthKit / Health Connect calls (like MapLibre and Auth0, they stay in the app). The app sends each workout's route samples (time, lat, lon, altitude) to the API, and the server reuses the existing activity parser, so metrics like `slowdownSlope` keep one source.
- **New API:**
  - `POST /activity-history/samples`: `{ source, externalId, sourceName, samples[] }`. `externalId` is the HealthKit workout UUID or the Health Connect record id, so re-syncs dedupe through the existing `upsertActivityHistory`.
  - `DELETE /activity-history/:historyId`, or an `excluded` flag, so the estimator skips a removed run and a re-sync doesn't bring it back.
  - `ActivityHistoryRef.source` adds `apple_health` and `health_connect`, plus an optional `sourceName` ("Garmin Connect").
- **Server-side recompute.** After an ingest that creates rows, the API recomputes the estimate for the athlete's races that start more than 7 days out, keeps the old finish for the note, and posts the chat system line. This keeps the rule in the API, not duplicated in two clients. Chat has no system messages yet, so this needs a new message kind.
- **Sync trigger.** App foreground, debounced (for example at most once per 30 min), runner role only, only while a connection is on. Incremental via HealthKit anchored queries and Health Connect change tokens.

## Gates and risks

1. **Route availability (test first).** Confirm on real devices that Garmin Connect and COROS write workout routes (not just summaries) to Apple Health and Health Connect. If a provider sends summaries only, decide whether summary-only runs (distance, time, climb, no slowdown slope) are good enough.
   - Desk research, Nov 24 2026 (third-party guides, nothing official): Garmin → Apple Health sends workouts without the GPS route, and the guides consistently agree on this. Garmin → Health Connect may include routes behind the "Exercise routes" permission. COROS → either store is unclear, with one guide saying no routes to Apple Health.
   - Device test, Nov 24 2026 (iPhone + COROS): **no GPS routes reach Apple Health, and the COROS app has no setting to send them.** Still open: whether COROS writes elevation gain to the workout.
   - Why elevation matters: the estimator needs only distance and elapsed time, but the micro-model treats a run with no `elevationGainMeters` as flat. A hilly trail run without its climb reads as slow flat pace and makes the estimate too slow. So a summary-only run is usable only if it carries elevation gain (HealthKit `HKMetadataKeyElevationAscended`, Health Connect `ElevationGainedRecord`).
2. **iOS:** HealthKit entitlement, `NSHealthShareUsageDescription`, an App Store privacy label update, and a privacy policy line.
3. **Android:** Health Connect permissions (`READ_EXERCISE`, `READ_EXERCISE_ROUTES`), plus the Play Console health-apps declaration and review, which can take weeks. Start it early. Health Connect shows a separate per-route consent the first time.
4. **Privacy (R3 in docs/kb/risks.md).** More history stored indefinitely. Account deletion and export must cover the new rows (they share the store, so check this).
5. **Physical proof.** Simulators have no real Garmin data. Checklist rows need physical-device proof (`"proof": "physical"`).

## Slices

1. Device test: a throwaway read of routes from Apple Health and Health Connect on real phones with Garmin and COROS data. Go/no-go for the rest.
2. API: `/activity-history/samples`, new sources, remove/exclude, contract tests.
3. API: recompute on ingest with the 7-day freeze, plus the chat system line.
4. client-core: sync model (12-month window, anchor, debounce, result states) and copy.
5. iOS: HealthKit read, onboarding + Settings buttons, banner. Simulator proof plus physical proof.
6. Android: Health Connect read, same UI. Emulator proof plus physical proof. Play declaration submitted in parallel.
7. Checklists: new `clients/behavior/health-sync.md` row; update `activity-import.md` and `onboarding-runner-setup.md`.
