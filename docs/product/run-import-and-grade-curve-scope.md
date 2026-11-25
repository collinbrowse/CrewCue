# Run import from watch apps + personal steepness curve

Status: scoped Nov 24 2026, not started. Replaces Apple Health / Health Connect sync, which is parked ([health-sync-scope.md](health-sync-scope.md)).

## Why

- **Runners need full GPS tracks.** A runner's pace depends on how they handle each kind of steepness, not on a run's total climb. Only a full GPS track shows that. Apple Health gets no routes from COROS (tested on a real phone Nov 24) and very likely none from Garmin, so Health sync can't provide them.
- **The model doesn't learn steepness yet.** It already prices each course segment by grade, but with one shared cost curve for everyone (`terrainEfficiency` is fixed at 1). Each past run becomes a single flat-equivalent pace, where every meter of climb counts as 4 extra flat meters (`runnerProfile.ts`). Only the late-race slowdown is learned from the track.

Two pieces of work fix this: one-tap sharing of activity files from watch apps into CrewCue, and a personal steepness curve learned from those tracks.

## Part 1: Share a run to CrewCue

### How runners get a file out of their watch app

| Watch app | Path | What CrewCue receives |
|---|---|---|
| COROS (phone app) | Open a run → ⋯ → Export → FIT → share sheet → CrewCue | `.fit` (also `.gpx` / `.tcx`) |
| COROS Training Hub (desktop) | Bulk export emailed as FIT or TCX | Many files, possibly a `.zip` |
| Garmin Connect | The phone app can't export. Use the Garmin Connect website (works in a phone browser) → activity → Export Original | `.zip` holding one `.fit` |
| Anything else | Files app → share → CrewCue | `.gpx` / `.fit` / `.tcx` / `.zip` |

### Product decisions

| Topic | Decision |
|---|---|
| Entry | CrewCue shows up as a share and open-in target for `.fit`, `.gpx`, `.tcx` and `.zip`. The existing Import a file button stays in onboarding and Settings > Past runs. |
| On receive | **Preview, then confirm.** One run: date, distance, time, climb, a small route map, and **Import**. A `.zip` or several files: a list with "41 runs · 3 can't be read", and **Import 41 runs**. |
| Signed out, or no account yet | **Ask to sign in first.** Show "Sign in to import runs." and drop the file. The runner shares it again after signing in. |
| Teaching | **One generic tip** on the Training history step and in Settings > Past runs: "Export a run from your watch app and share it to CrewCue." |
| Estimate updates | Same rules agreed for Health sync: new runs recompute the estimate, the runner sees old → new in hours and minutes, a system line goes to the race chat with no push, and updates freeze 7 days before the start. |
| Duplicates | Unchanged: the same file imported again keeps one row (content fingerprint). The preview marks runs that are already imported. |

### Copy (draft)

- Tip: "Export a run from your watch app and share it to CrewCue."
- Preview, one run: "Import this run?" · stats · **Import** / Cancel.
- Preview, many: "Import 41 runs?" · "3 files can't be read" (expandable list) · **Import 41 runs** / Cancel.
- Done: "Run imported." / "41 runs imported."
- Signed out: "Sign in to import runs."
- Unreadable: existing copy, "Couldn't read that file. Choose a .gpx, .fit or .tcx export." Add `.zip` to the list.

### Technical shape

- **iOS:** declare document types (`CFBundleDocumentTypes` plus imported UTIs for `.fit` and `.tcx`, alongside the system types for `.gpx` and `.zip`). Handle the file URL in `onOpenURL`. No share extension: the app opens, so auth and the preview reuse the app's own session.
- **Android:** `ACTION_VIEW` / `ACTION_SEND` / `ACTION_SEND_MULTIPLE` intent filters on the main activity. `.fit` has no standard MIME type, so filter `application/octet-stream` as well and check the extension after receiving.
- **API:**
  - `POST /activity-history/file/preview`: parses without saving and returns metrics, a simplified track, and whether the run is already imported. This mirrors `course/gpx-preview`. Confirm uses the existing `POST /activity-history/file`.
  - **Zip:** unzip on the server so there's one implementation. A single-activity Garmin zip fits the current 10 MB limit. Bulk zips need a larger limit or a per-file upload loop from the client. Decide in the zip slice.
- **client-core:** an incoming-file model holding the states (signed out, previewing, importing, done, partial failure) and the copy. The platform apps own the document and intent plumbing.

### Bulk import (Nov 24 2026)

A COROS bulk export holds every activity, years of them: the owner's was 2,085 FIT files, 128 MB zipped. The JSON routes (20 MB, 500 files) can't take that, so clients send the file's raw bytes to `POST /activity-history/upload?mode=preview|import&fileName=`. That route takes up to 200 MB and 5,000 files, read one at a time.

- **What's kept:** a multi-run upload keeps runs, trail runs and hikes from the year before its newest run.
- **What's skipped and counted:** rides, walks and other sports, older runs, and files without a run. The preview shows "1,905 files skipped: …" and lists up to 50 unreadable names.
- **A single shared run** imports whatever its date.
- **Android** streams the shared file to its cache and passes the path through the bridge, so 100+ MB never crosses JNI as text.
- **Owner's export on the simulator:** preview about 7 s, import 16.5 s locally, 174 runs saved.
- **Timeout risk:** a slower server could pass the client's 60 s idle timeout on import. If that shows up, move import to a background job.

## Part 2: Personal climbing and descent model

### Idea

From each GPS track, measure how the runner moves at each grade: whether they **run or hike**, and how fast, compared with **their own flat pace in the same run**. Taking the ratio cancels effort: an easy training run and a race both show how this runner climbs and descends relative to their flat pace. Pooled across runs, this gives a personal climbing and descent model. Each part starts at the typical runner's value and moves toward the runner's own as data builds up. That's the same shrinkage pattern the late-race slowdown uses (`slowdownShrinkage.ts`).

### The model: six personal values

Climbing is where runners differ most, so it isn't collapsed into one number. Runnable climbing and power-hiking are learned separately, along with the grade where the runner switches between them.

| Value | What it captures | Measured as |
|---|---|---|
| Flat pace | Baseline | Moving pace from about −2% to +2% |
| Runnable-climb factor | How fast they *run* uphill compared with typical | Running pace on climbs below the switch grade ÷ (flat pace × shared cost at that grade) |
| Hiking factor | How fast they *power-hike* | Vertical meters per hour while hiking, compared with typical. Hiking speed tracks vertical gain better than distance. |
| Switch grade | Where they switch from running to hiking | The grade where half their climbing distance is run and half hiked |
| Descent factor | Runnable descents (about −2% to −15%) | Pace ÷ (flat pace × shared cost) |
| Steep-descent factor | Technical and braking descents (steeper than −15%, matching the existing `TECHNICAL_DOWNHILL_GRADE`) | Same |

**Running or hiking:** FIT files record cadence every second, and COROS includes it. Running is roughly 150+ steps per minute and hiking well below that. This gives each moment a run or hike label directly, so the switch grade comes from the runner's own behavior, not a guess. A short smoothing window stops a single slow step from flipping the label. Files without cadence (most GPX) fall back to a speed and grade rule, and count for less in the hiking factor and switch grade.

**Typical starting values and trust:** each value starts at a population default. The switch grade starts at about 12%. The others start at 1 (the shared curve). Each moves toward the runner's measurement in proportion to how much distance (or, for hiking, vertical gain) they have in that range. A road runner with little steep data stays near typical. A runner who differs a lot on climbs gets their own numbers once their files have enough climbing.

### How finely the track is cut

Two jobs are kept apart:

- **Grade comes from a smoothed elevation profile.** Grade is rise ÷ distance, so over very short distances small elevation errors explode. A 0.3 m altitude wobble over 3 m reads as a 10% grade, and GPS position jitter of about 3 m can double or erase a 3 m distance. The elevation is smoothed over about 30 m (to be tuned), using the watch's barometric altitude when the file has it. This is long enough to cancel noise and short enough to keep short steep pitches.
- **Labels are fine, segments follow changes.** Every recorded point (about one per second, every 2–4 m when running) gets its smoothed grade and its run or hike label. The track is then cut wherever the label changes or the grade moves to a different range, with a minimum piece of about 20 m. A 100 m stretch that goes run → hike → downhill becomes three pieces, not one blurred average.

**File quality sets the detail.** Accuracy is judged from each file, not from the watch brand or a GPS-accuracy claim:

- **Measure each file:**
  - **Elevation noise:** how much altitude jitters around its smoothed line.
  - **Barometric or not:** whether the altitude comes from a barometer.
  - **Point density:** how often a point is recorded. Smart recording or long gaps lower it.
  - **Map-corrected elevation:** whether the altitude has been replaced by terrain-map values. Signs are values that are suspiciously smooth or stepped, or a GPX export from a platform that applies corrections.
- **Pick the smoothing window from that:**
  - **About 15 m:** clean, dense, barometric files (for example a dual-band watch's original FIT).
  - **About 30 m:** typical files.
  - **About 40 m:** noisy, sparse or map-corrected files.

  These numbers are starting points to tune in the backtest.
- **Weight by quality:** noisy files count for less when fitting the six values, so one bad track can't pull a runner's numbers.
- **Run or hike labels don't depend on any of this.** Cadence comes from the watch's motion sensor, not GPS.
- **Prefer original files.** The import tip and the Garmin path point to "Export Original" (raw FIT) over GPX, because GPX exports often carry corrected elevation that flattens short pitches.
- **Check the course file too.** Organizer GPX files are often sparse, with map-derived elevation. The course gets the same check, and its segment detail follows its quality. A prediction is only as fine as the coarser of the runner's data and the course's.
- **The bigger limit is the runner, not the GPS.** Day-to-day differences in effort, fatigue, heat and surface move climbing pace more than the gap between 15 m and 30 m smoothing. Finer data refines the estimate, but doesn't make it exact.

**What each run stores:** a small table rather than the file. Distance and moving seconds for each 1% grade step (−40% to +40%), split by running and hiking. That's about 160 numbers per run. Because the table is this fine, the model can be refit later, with new cut-offs or new values, without the original file.

**The course must be cut the same way.** Course segments are currently 100 m with no elevation smoothing (`MICRO_SEGMENT_TARGET_METERS`). At 100 m, a 40 m wall at 25% averages away and the hiking switch would rarely trigger. Course segments should move to the same smoothed profile at about 20–25 m. Computing cost is small: a 100-mile course becomes about 7,000 segments instead of 1,600. Measure the scenario simulation time before and after.

### Implementation

1. **Parse (API, per file):** score the file's quality and pick its smoothing window, smooth the elevation, label each point as running or hiking (cadence, else a speed and grade rule), drop stopped time (speed under about 0.5 m/s, or time gaps), and build the 1% grade table. Store it on `ActivityHistoryRef` with the file's quality score and whether cadence was present.
2. **Profile:** fit the six values from the pooled tables, with shrinkage toward typical. Optionally replace the 4 m/m flat-equivalent rule with the measured flat pace once a runner has enough flat distance.
3. **Simulate:** on each course segment, decide run or hike from its grade against the runner's switch grade. Price running segments with the shared cost × the climb or descent factor. Price hiking segments from the hiking climb rate. The flat-equivalent baseline must not double count. Tests pin this down.
4. **Flag:** behind a new flag, off in production until the backtest passes. Same approach as `PROJECTION_TUNED_CONSTANTS`.

### Backtest (go/no-go)

OpenSplitTime permission was granted Nov 5, with attribution. For each finisher, fit their personal multipliers from the first half's section splits against each section's grade profile from the course GPX. Then predict the second half and compare with the shared curve. If personal curves don't beat the shared one on held-out courses, stop at Part 1.

This test only partly checks the model. Sections are 5–15 km long and mix runnable and hiking grades, and split times include aid stops, night and fatigue, which the model already handles separately. It can show whether climbing and descent ability is personal and consistent. The switch grade and the runnable-versus-hiking split will mostly have to be proven on CrewCue runners' own files, by predicting a held-out run of theirs, so the flag stays off until enough of those exist.

### Backtest result (Nov 24 2026)

Run with `npm run projection:backtest -- --analysis personal-terrain` (services/api). Data, not committed: OpenSplitTime Hardrock 2023 and 2025 (counter-clockwise), Hardrock 2024 (clockwise, on the counter-clockwise GPX reversed; 2026 used a different checkpoint layout), and Bear 2026 (the new course). That's 585 finishers on 3 courses. The other picked races weren't usable: Bighorn has only 2014 results on OpenSplitTime, and Wasatch, Cascade Crest and Run Rabbit Run aren't there.

- **Predicting the second half: no gain.** Held out one course at a time, second-half error stayed at 91 min for both the shared and the personal model, and the shrinkage picked was the strongest. A method check shows why this says little: with planted personal traits (σ 15%), the gain was also only about 0.1 min. OpenSplitTime sections are 5–15 km of mixed terrain, so section totals can't separate climbing from descending ability well enough to move a half-race prediction.
- **Is it a personal trait? Weakly.** Correlation between a runner's first-half and second-half terrain factors, against finishers of similar finish time, with a per-half fade control. Noise alone stays within about ±0.13–0.18.

  | Course | Runnable climb | Hiking-grade climb | Runnable descent | Steep descent |
  |---|---|---|---|---|
  | Bear 2026 | 0.05 | 0.09 | 0.08 | −0.07 |
  | Hardrock CCW | −0.02 | **0.17** | **0.22** | 0.06 |
  | Hardrock CW | 0.04 | 0.05 | 0.16 | 0.08 |

  With planted traits, the same correlation reaches 0.35–0.59. Comparing the two puts the real spread between similar-speed runners at roughly 5–7% per terrain class, clearest for runnable descents and hiking-grade climbs on Hardrock. That's a modest, partly-detectable signal, not a strong one.
- **What this does and doesn't say.** Most terrain skill moves with overall speed, which the model already captures from the runner's overall pace. The personal part left over is small. Race split data has too little resolution to show whether a runner's own 5 m GPS tracks with cadence could estimate it well. Those tracks are far richer, so this is "unproven", not "no".

**Recommendation (owner's call):** don't turn the six-value model on from this evidence. Keep collecting grade tables (slice 1), build the share-sheet import (slices 4–7) because it pays off on its own, and re-test on runners' own files: fit on their training runs and predict a held-out run or a finished CrewCue race. Slice 3 waits for that test.

### Own-runs test (Nov 24 2026, one runner)

Run with `npm run own-runs:backtest -- <folder>` (services/api). Data: 14 of the owner's COROS runs from June to November 2026 (7 FIT, 3 TCX, 4 GPX), 7–37 km with 200–3,800 m of climbing. They stay local in the git-ignored `projection-backtest-data/my-runs`.

The test leaves one run out and learns from the other 13. Each model's step times are scaled to the held-out run's actual moving time, so effort cancels and only *where the time goes* is scored: the share of moving time placed in the wrong kilometer.

| Model | Moving time misplaced (mean of 14) |
|---|---|
| Shared curve | **5.3%** |
| Six-value (switch grade + 5 class factors) | 5.8% (5.7% with each run weighted equally) |
| Per-1%-grade factors | 5.8% |

- **The personal versions did worse.** Each class has kilometers of data, so this isn't small samples. The runner's relation to grade, measured against their own level, changes from run to run more than it holds steady. That fits a mix of long hiking days (up to 9.6 h with 61% hiked) and short runs, where fatigue, stops and technical footing move time around.
- **Learned values** (all 14 runs, relative to the runner's own level; above 1 means slower than the shared curve predicts):
  - Switch grade: 11%.
  - Hiking-grade climbs: 0.93–0.96, faster than predicted.
  - Steep descents: 0.89–0.94, faster.
  - Runnable climbs and descents: 1.03–1.12, slower.
  - These directions fit the owner's sense of being strong on climbs. But on these runs, knowing them didn't place time better.
- **Limits.** This is one runner and 14 runs, mostly training, with no races. The metric removes total-time differences on purpose, so it can't test whether personal values predict a race's *total* better from training. That needs race files, which the bulk export (due about Nov 29) should include.

**Combined with the OpenSplitTime result:** neither test supports turning on personal grade factors. Keep slice 3 parked, keep collecting grade tables, and re-run both tests with the bulk export and the first CrewCue races.

### Limits

- Runs imported before this change have no grade table. The API keeps only metrics, not the file, so runners would need to re-import. The estimate still works without bands.
- Short or flat-only histories leave the steep bands empty. Shrinkage keeps those bands at the shared curve.
- Training on a different surface than the race (road vs technical trail) mixes terrain into the grade bands. Accept this for now.

## Slices

1. **API, grade table in the parser.** File quality score, quality-based smoothing, run or hike labels, and the 1% grade table on the contract and store, with fixture tests (COROS FIT with cadence, GPX, TCX). No model change, but tracks start carrying the table from day one.
2. **Backtest.** Personal versus shared climbing on OpenSplitTime splits. Go/no-go for slice 3.
3. **API, the six-value model** in the runner profile and simulation, plus 20–25 m smoothed course segments, behind a flag.
4. **API, preview endpoint and zip support**, single-activity zip first, then bulk.
5. **client-core,** incoming-file model, states and copy.
6. **iOS,** document types, open handling and preview screen. Simulator proof, plus a real-phone COROS share.
7. **Android,** intent filters and preview. Emulator proof, plus a real-phone share.
8. **API, estimate recompute on new runs,** with the 7-day freeze and the chat system line (chat has no system messages yet).
9. **Checklists:** a new `clients/behavior/run-share-import.md`, and updates to `activity-import.md` and `onboarding-runner-setup.md`.

Slices 1 and 4–7 deliver the fewer-steps goal on their own. Slices 2–3 can run in parallel with them.
