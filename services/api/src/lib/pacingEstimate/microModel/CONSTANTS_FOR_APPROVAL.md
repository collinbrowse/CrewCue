# Micro-model constants — for approval

Proposed numeric defaults for the physiology pacing estimator. Treat as provisional until signed off.

**Source of truth:** `[constants.ts](./constants.ts)`

---

## Baseline & course mesh


| Constant                  | Value                         | Role                                                       |
| ------------------------- | ----------------------------- | ---------------------------------------------------------- |
| Cold-start GAP            | **10:00 / mi** (600 s/mi)     | True flat GAP when there is no usable history              |
| Surface C_i               | **1.0**                       | Surface factor disabled until a reliable map source exists |
| Micro-segment target      | **100 m**                     | Route mesh step for slope / altitude samples               |
| Terrain efficiency E(g)   | **1.0**                       | No athlete-specific slope fit (summaries only this epic)   |
| History similarity window | **0.02×–2.0×** course distance, ≥ **5 km** absolute | Wide enough for weekday training on 100–250 mi races |
| Prefer longer when available | Prefer activities ≥ **20 km** (~12.4 mi) if any exist | Else use the full wide window |


---

## Coherent model change (C1–C4, PR C / #483)

The four pieces below are one coherent estimator: history is decoupled from its own training terrain
(C1) so the full physiological grade curve (C4) can apply on the course without double-counting;
distance is handled by endurance scaling (C2); fatigue only reshapes the total (C3). Calibrated
offline via the backtest harness (PR B, `npm run pacing:backtest`).

### C1 — flat-equivalent GAP from summary elevation

`flatEquivPace = Σ elapsed / Σ (distance + c · gain)`, with **c = 4.0 m flat-equivalent per m climbed**.
Removes the athlete's own training terrain from the baseline pace so the course grade model is not
double-counted. Rows without `elevationGainMeters` contribute 0 gain (treated as already flat).

### C2 — Riegel endurance scaling

`enduranceFactor = max(1, (D_course / D_ref)^k)` with **k = 0.19** (the Riegel exponent minus 1),
`D_ref = Σ D² / Σ D` over the selected history. ≈ 1.5× at 100 mi from a 20 km reference; never
scales below 1 (no predicting faster than observed pace). Cold start = 1.

### C3 — fatigue is shape-only (renormalized)

Fatigue `(1 + γ₁·W + γ₂·D_down)` is renormalized across the course so it **redistributes** the
endurance-scaled terrain total (later slower, earlier faster) without inflating the finish:
`duration_i = base_i · fatigue_i · (Σ base / Σ base·fatigue)`. Endurance owns the total, γ owns the
shape, M(g) owns terrain.

### C4 — restored physiological M(g), blend 1.0

## Grade & altitude


| Constant              | Value                                                                        | Role                                          |
| --------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| Relative M(g) uphill  | 1 + 1.7g + 13g² (g ≥ 0)                                                       | +12% @5%, +30% @10%, +55% @15%; g = rise/run  |
| Relative M(g) downhill| 1 + 2.4g + 12g² (g < 0), clamped ≥ **0.7**                                    | Shallow downhill cheaper than flat; braking dominates by ≈ −20% |
| Grade cost blend (cold) | **1.0**                                                                    | Full model — C1 removes the double-counting the old damping compensated for |
| Grade cost blend (history) | **1.0**                                                                 | Same; blend plumbing retained for a future athlete-specific E(g) |
| Technical downhill    | g < -15 → **×1.08** extra                                                    | Braking / eccentric penalty on steep descents |
| Altitude F_{alt}      | 1 - 0.01 \times \frac{\mathrm{Alt} - 1500}{300} for Alt > 1500 m; else **1** | Oxygen / altitude slowdown (also blended)     |


Effective cost: `1 + (M(g)·E(g)·[downhill] − 1) × blend` (same blend on altitude deficit); blend = 1.0.

---

## Fatigue (shape-only, see C3)

Fatigue shape P ∝ (1 + \gamma_1 W_{cum} + \gamma_2 D_{down}); **renormalized so it does not change the
finish time**, only the split of time across the course (endurance C2 owns the total).


| Constant | Value                           | Role                                |
| -------- | ------------------------------- | ----------------------------------- |
| \gamma_1 | **2.5×10⁻⁷** per m·work         | Late-race work fatigue (shape)      |
| \gamma_2 | **4×10⁻⁵** per m descent-impact | Eccentric downhill fatigue (shape)  |


---

## Scenario bands (three deterministic re-sims)

Not finish-time ratio stretch. Schedule plan-of-record uses **expected** only.


| Scenario     | GAP   | \gamma_1 | \gamma_2 | Altitude penalty |
| ------------ | ----- | -------- | -------- | ---------------- |
| Expected     | ×1.00 | ×1.00    | ×1.00    | ×1.00            |
| Conservative | ×1.06 | ×1.35    | ×1.40    | ×1.15            |
| Aggressive   | ×0.94 | ×0.75    | ×0.70    | ×0.90            |


Ordering invariant: conservative ≥ expected ≥ aggressive (elapsed seconds). With C3 (shape-only
fatigue) the γ knobs now reshape each re-sim's split; the finish spread between bands comes from the
GAP and altitude knobs.

---

## Calibration note (early-course bias) — RETRACTED, see #478

The original note read: *"First field use projected first aid ~44 min late. Root cause: treating history mean elapsed/distance as flat GAP, then re-applying Minetti-style hills → double-counted terrain. Fix: softer M(g) + history blend 0.22 / cold blend 0.55."*

**That attribution was wrong, and the micro-model was not the source of the error.** Verified against the deployed database: `pacingEstimateId` is NULL on every race room and `pacing_estimate_json` is empty, so no estimate has ever been generated or attached. Every schedule observed in the field came from the fallback path instead — `plannedPaceSecondsPerKm` (the hardcoded 6:00/km default, since planned course GPX carries no timestamps) plus `buildPlanBaselineFromModel`.

The real cause was that fallback's climb penalty of 8 s per meter of gain, roughly double a defensible running value. On a nearly flat 50 km with 348 m of gain it alone added 46 minutes. Corrected to 3.6 s/m in #478.

**Consequence for the constants below:** the softened `M(g)` and the history blend of 0.22 were fitted to an error produced by a different code path, so neither is validated by field evidence. Both should be reverted and re-derived against a backtest harness before being trusted.

### Resolution (C1–C4, PR C / #483)

Both were reverted. The softened `M(g)` and the 0.22/0.55 blends are gone: the full physiological
`M(g)` is restored at blend 1.0 (C4), and the double-counting they compensated for is removed at the
source by the flat-equivalent GAP (C1). Distance now comes from Riegel endurance scaling (C2) and
fatigue is shape-only (C3). The backtest harness (`npm run pacing:backtest`) exists for offline
calibration; the numbers below remain **provisional pending a real completed-effort backtest and a
single field validation** (per `pacing-accuracy-program.md`, after PR D).

---

## Approval

- [x] Cold-start GAP (10:00/mi)
- [x] Surface held at 1.0
- [x] Grade / downhill / altitude formulas — full physiological M(g) restored at blend 1.0 (C4, #483); double-counting removed by C1
- [x] C1 gain→flat-equivalent factor (4.0 m/m) — provisional, backtest-tunable
- [x] C2 Riegel endurance exponent (k = 0.19) — provisional, backtest-tunable
- [x] C3 fatigue renormalization (shape-only)
- [x] Fatigue \gamma_1, \gamma_2 (shape)
- [x] Scenario knob table

---

## Course-aware plan and live projection (PR 3) — behind `PROJECTION_TUNED_CONSTANTS`

**Status: confirmed on permitted data; still OFF in production until the flag is turned on.** First
fit on the Nov 3–4 2026 backtest of scraped finisher splits (about 5,500 finishers on 6 courses,
held out one course at a time): five OpenSplitTime courses (Hardrock 100, Bear 100, Never Summer
100K and 60K, Quad Rock 50) and UTMB 2022 from LiveTrail. OpenSplitTime granted permission on
Nov 5 2026 (it asked for an attribution line). LiveTrail hasn't, so UTMB is out.

**Nov 5 re-check on OpenSplitTime only** (5 courses, 3,817 finishers, leave-one-course-out):
- Slowdown fits 0.20–0.25 per held-out course. Night pooled +7.3%.
- Bias terms refit per held-out course: A +0.085…+0.111, B −0.195…−0.218, C +0.303…+0.350. The
  shipped values are inside or next to those ranges and score slightly better than the refit
  (all-runner finish 49.2 vs 50.2 min).
- Finish / next-aid error, all runners: server today 69.5 / 18.1 → PR 3 with the shipped
  constants 49.2 / 15.2. Mixed plan-quality field: 63.4 → 50.9 min.

The constants run only when `PROJECTION_TUNED_CONSTANTS=1`. With it unset, the estimate and the
ETAs match the pre-PR model exactly.

**Source of truth:** `[../../projectionTuning.ts](../../projectionTuning.ts)`

| Constant | Value | Role | Backtest basis |
| --- | --- | --- | --- |
| `SLOWDOWN_SLOPE_DEFAULT` | **0.24** | Section time × (1 + s·(progress − 0.5)), renormalized to keep the total. The GPX model under-predicts late-race slowdown on every course. | Held-out slope 0.22–0.26 on all 6 courses |
| `NIGHT_PACE_FACTOR` | **1.06** while the sun is below **−6°** | Moving time in the dark, at the course start's location and the simulated clock time. Adds time. | Speed-adjusted: Bear +16%, Hardrock +9%, UTMB +6%, Never Summer +3%; pooled +6% |
| `PLAN_LOG_SIGMA` | cold **0.30** · coarse history **0.20** · similar history **0.12** | The plan's expected finish log-error, stored as `baselineTrack.planLogSigma`. A missing value means 0.12. | Reasoned tiers; the backtest plan error was synthetic. PR 6 measures them from finished rooms. |
| `LIVE_RATIO_HALF_LIFE_METERS` | **40,000** | Recency weight on actual ÷ planned time covered so far | Best of 2–80 km |
| `LIVE_TRUST_VARIANCE` | **0.0043** | trust = 0.0043 / σ²; w = seen / (seen + trust) | Matched the best fixed trust at plan errors of 6/12/20/30%. Mixed field: 90 min vs 102 for the best constant. |
| `LIVE_BIAS_A, B, C` | **+0.09, −0.21, +0.36** | r_rem = r·exp(A + B·seen + C·clamp(ln ratio, ±1)·(1 − w)). Corrects the shape the slowdown fix leaves behind (fast first and last 10%, slow middle), and returns part of the ratio that trust held back. | All-runner finish error 87 → 78 min; UTMB 109 → 96; every course improved |
| `K_STOP` | **2** | Stop habit = (2 + Σ actual/planned) / (2 + n) over the planned stops passed, applied to the planned stops ahead | Reasoned shrinkage; not yet backtested (needs in/out times) |

Live formula: `ETA_j = elapsedNow + r_rem · (plan_j − plan_now) + stopHabit · Σ planned stops before j`.
- Time stopped at a checkpoint with a crew-planned stop is left out of the ratio, so it is counted once.
- Other stops stay in the ratio and are spread over the rest of the course, as the backtest measured.

Tested and left out:
- A non-linear progress curve in the plan. Stacked with the bias layer, it erased the gain.
- Projecting a runner's recent fade forward. No gain: slow stretches tend to bounce back.

## Learning from CrewCue's own finished races (PR 6)

This is first-party data, so it needs no outside permission. The values below run only when `PROJECTION_TUNED_CONSTANTS` is on, like the rest of the tuned pace model. Measurements are recorded whatever the flag.

| Constant | Value | Role |
| --- | --- | --- |
| `PLAN_SIGMA_MIN_ROOMS` | **20** finished rooms per branch | Then that branch's σ = RMS of ln(actual ÷ planned finish), replacing the provisional tier |
| `SLOWDOWN_SHRINK_K` | **2** race-equivalents | personal = (2·0.24 + Σ wᵢ·sᵢ) / (2 + Σ wᵢ) |
| `SLOWDOWN_FULL_WEIGHT_METERS` | **80 km** | wᵢ = min(1, distanceᵢ / 80 km) |
| `SLOWDOWN_MIN_EFFORT_METERS` | **30 km** | Shorter efforts are not measured |
| `SLOWDOWN_MIN_COVERAGE` | **80%** of the course in timed sections, at least 3 sections | Otherwise no slope |
| `SLOWDOWN_SLOPE_RANGE` | **[0, 0.6]** | Clamp on the personal slope |

How slowdown is measured:
- For each section, take (actual ÷ planned moving time), normalized by the effort's overall ratio, and regress it on the section's progress.
- The plan is the micro-model's cold-start shape over the same route without any slowdown, so the measured slope is the whole slowdown.
- Sources: CrewCue races (sections between checkpoint crossings, stops taken out) and timed GPX uploads (about 5 km sections).

`K = 2` is a reasoned default. Validate it on repeat runners once permitted data with linked runners exists.

`npm run finished-efforts:report` prints rooms per branch, measured σ, slowdowns, and stop medians by tag, race quarter and darkness.

## Course history (PR 4) — data-gated, and behind `PROJECTION_TUNED_CONSTANTS`

| Constant | Value | Role |
| --- | --- | --- |
| `COURSE_HISTORY_PRODUCT_SOURCES` | env, default **`crewcue,opensplittime`** | Sources whose events may feed the product. Every other source is stored `backtest_only` |
| `COURSE_HISTORY_MIN_FINISHERS` | **25** | Past finishers needed on the mapped layout before history changes a plan or an ETA. Nov 4 analysis: the gain levels off at 10–25 |
| Plan band | ±**10%** of planned finish (at least 5, else the nearest 10) | Plan shape = median share of finish at each checkpoint among these finishers |
| Live band | ±**30%** of the runner's elapsed at the last checkpoint (nearest 100, at least **4**), outliers beyond 1.5×IQR dropped | Past-runners estimate. The live ETA is the average of it and the projection |
| `LINK_POSITION_METERS` | **300 m** | Checkpoint mapping by position. Fallbacks: name, then share of the course within **2%** |
| `LINK_MIN_AID_COVERAGE` | **80%** of the room's aid checkpoints | Needed to link an event |
| Auto-link | start and finish within **500 m**, length within **5%**, one checkpoint layout | Otherwise an operator links with `npm run course-history:link` |

**Data-gated:**
- With the default source list, CrewCue's own finished races and OpenSplitTime events feed the product. OpenSplitTime events are imported with `npm run course-history:import -- --opensplittime <event-slug…>`.
- OpenSplitTime gives no checkpoint coordinates, so its events don't auto-link (auto-link matches start and finish positions). Link a room by hand: `npm run course-history:link -- <roomId> opensplittime:<slug>…`. Checkpoints then map by name, then by share of the course.
- An estimate shaped by OpenSplitTime results says so in its explanation: "(results from OpenSplitTime.org)", the attribution OpenSplitTime asked for.
- The plan shape and the live blend also need the tuned flag.

**Gate: passed on OpenSplitTime data (Nov 5 2026).** On runners whose course has prior years (2,985 runners, 4 courses), the 50/50 blend of the live projection and the past-runners estimate scores a finish error of **40.0 min** and a next-aid error of **10.1 min**, against the gate of 41 / 11. At 25 past finishers per runner it's 40.7 / 10.2. The past-runner plan shape plus the blend together weren't scored yet.

## Arrival windows (PR 5) — behind `PROJECTION_TUNED_CONSTANTS`, table fitted on OpenSplitTime data

**Source of truth:** `[../../arrivalWindows.ts](../../arrivalWindows.ts)`, with the table in `[../../arrivalWindowTable.ts](../../arrivalWindowTable.ts)`.

| Constant | Value | Role |
| --- | --- | --- |
| Window | 10th–90th percentile (80% nominal) | `elapsedNow + remaining × [exp(q10), exp(q90)]` around each live ETA |
| Progress bands | 0–25%, 25–50%, 50–75%, 75–100% of course covered | Table rows, together with σ tier (cold / coarse / similar history) and linked course history |
| `WINDOW_MIN_COVERAGE` | **70%** held-out | A band below this gets no window, so clients show the ETA alone |
| Target coverage | **75–85%** held-out | What the backtest reports each band against |
| Between checkpoints | linear in remaining plan time | Quantiles go from the next-checkpoint band to the finish band |

**Table: fitted Nov 5 2026** on OpenSplitTime public results, used with OpenSplitTime's permission: 5 courses (Hardrock 100 counter-clockwise, Bear 100, Never Summer 100K and 60K, Quad Rock 50), 3,817 finishers. Coverage is held out one course at a time. UTMB (LiveTrail) is left out because LiveTrail hasn't given permission.

| Band | Next checkpoint: held-out coverage | Finish: held-out coverage |
| --- | --- | --- |
| 0–25% | 72–74% (below target, above the 70% gate) | 80% |
| 25–50% | 79% | 77–78% |
| 50–75% | 74–75% (below target, above the gate) | 76% |
| 75–100% | 77% | 80% |

Ranges span the three σ tiers, which come out nearly the same because the backtest's plan error is synthetic. Every band clears the 70% gate, so every band gets a window. Typical widths: next checkpoint ×0.83–×1.25 of the remaining time; finish ×0.85–×1.18. Bands with linked course history (`hasHistory: true`) aren't fitted yet, so they fall back to no window until a refit with history wired in (follow-up once PR 4 merges).

To refit the table, run `npm run projection:backtest -- --data <permitted data> --analysis windows --write-windows --windows-source "<dataset, permission, date>"` and commit the generated table. The tool refuses to write a table from the synthetic fixture.
