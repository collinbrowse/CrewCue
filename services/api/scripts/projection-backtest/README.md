# Projection backtest

This is the TypeScript port of the Nov 3–4 reference analysis (plan PR 2). It scores live finish and next-aid ETAs on finishers' real splits. PRs 3–6 are tuned and checked with it.

```bash
npm run projection:backtest                                  # headline report, local data folder
npm run projection:backtest -- --fixture                     # committed SYNTHETIC fixture
npm run projection:backtest -- --analysis all                # every ported analysis
npm run projection:backtest -- --analysis night,prior-sweep --sigma 0.2
```

CI runs `npm run projection:backtest:check -w @crewcue/api` as part of the API `test` script. That runs every analysis on the fixture, checks that the scores are finite, and checks parity with production (below).

## Data rules

- **No race data is committed.** Real events go in `services/api/projection-backtest-data/`, which is git-ignored, or in any folder passed with `--data`.
- **OpenSplitTime:** don't fetch or use its data, including the scraped Nov 3–4 pages, until OST grants permission. There is no OST adapter.
- **LiveTrail:** its legal notice requires prior written permission to reuse the site or its databases. Treat its data the same as OST's.
- The fixture in `fixtures/projection-backtest/` is generated (`npm run projection:backtest:make-fixture -w @crewcue/api`). Its runners follow the micro-model with a known slowdown (0.30), night factor (1.06), noise and aid stops. Its numbers show the tool works; they say nothing about real accuracy.

## Data folder

```
manifest.json   { "courses": [{ "key": "hardrock-ccw", "gpx": "hardrock.gpx", "events": ["hardrock-2023.json", …] }] }
<gpx>           the official course: the plan shape comes from the production micro-model over it
<events>        split format: services/api/src/lib/courseHistory/format.ts (one event or an array)
```

Each course uses one checkpoint layout: the most common across its events, weighted by finisher count. Checkpoints with lat/lon on every row are projected onto the GPX in order. Otherwise they are placed by their share of the source distance. Efforts missing a checkpoint are skipped. Earlier events on the same course and layout become the past-runner pool.

## Modules

| File | What |
| --- | --- |
| `data.ts` | Loads events (validated by the file-import source) and builds plans with the production micro-model (`buildCourseMicroSegments`, `buildRunnerProfile`, `runScenarioSims`, as `gpx_plans.mts` did). Interpolates with production `plannedElapsedSecondsForDistance`, and fits the leave-one-course-out slowdown fix. |
| `formulas.ts` | **The one module PR 3 replaces with production calls**: live ratio, plan trust, bias layer, past-runner method, plan reshaping, sun elevation. The constants are the provisional Nov 4 values. |
| `parity.ts` | Replays fixture runners as pings through production `recomputeRaceProjection` and checks that `formulas.anchoredEta` matches today's finish ETA within 1 s. |
| `score.ts` | Scoring (average minutes off), leave-one-course-out fitting, tables. |
| `analyses.ts` | `headline` plus one function per reference script. |

## Analyses (reference script → name)

| Reference | `--analysis` |
| --- | --- |
| (new) by course, by progress, next aid, mixed plan-quality field | `headline` (default) |
| `gpx_backtest.py` | `gpx-backtest` |
| `gpx_fade.py` | `gpx-fade` |
| `night.py` | `night` (race start from the event's `startTime`, location from the first GPX point) |
| `prior_sweep.py` | `prior-sweep` |
| `fresh_look.py` / `fresh_look2.py` / `fresh_look3.py` | `fresh-look` / `fresh-look-2` / `fresh-look-3` |
| `history_size.py` | `history-size` |

**Differences from the Python:**
- The RNG is seeded mulberry32, so plan-noise draws differ from Python's `random`.
- The reference split UTMB and Hardrock by hand. "Long courses" here means 90 km or more.
- The reference counted next aid twice at the last aid. Here it is counted once.
- `utmb_diag.py` and `gpx_shape_diag.py` were diagnostics and are not ported.
