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

## Grade & altitude


| Constant              | Value                                                                        | Role                                          |
| --------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| Soft relative M(g)    | 1 + 1.5g + 3.5g² + 6g³ (clamped ≥ 0.7)                                       | Running-oriented cost vs flat; g = rise/run   |
| Grade cost blend (cold) | **0.55**                                                                   | Fraction of M(g) / altitude applied on cold start |
| Grade cost blend (history) | **0.22**                                                                | History summaries already include trail cost — dampen grade/altitude to avoid double-counting |
| Technical downhill    | g < -15 → **×1.08** extra                                                    | Braking / eccentric penalty on steep descents |
| Altitude F_{alt}      | 1 - 0.01 \times \frac{\mathrm{Alt} - 1500}{300} for Alt > 1500 m; else **1** | Oxygen / altitude slowdown (also blended)     |


Effective cost: `1 + (M(g)·E(g)·[downhill] − 1) × blend` (same blend on altitude deficit).

---

## Fatigue

Pace scales as P = P_0 \times (1 + \gamma_1 W_{cum} + \gamma_2 D_{down}).


| Constant | Value                           | Role                                |
| -------- | ------------------------------- | ----------------------------------- |
| \gamma_1 | **2.5×10⁻⁷** per m·work         | Metabolic / cumulative work fatigue |
| \gamma_2 | **4×10⁻⁵** per m descent-impact | Eccentric downhill fatigue          |


Target feel: ~8–12% late-race slowdown on a ~50 km / ~1500 m gain effort.

---

## Scenario bands (three deterministic re-sims)

Not finish-time ratio stretch. Schedule plan-of-record uses **expected** only.


| Scenario     | GAP   | \gamma_1 | \gamma_2 | Altitude penalty |
| ------------ | ----- | -------- | -------- | ---------------- |
| Expected     | ×1.00 | ×1.00    | ×1.00    | ×1.00            |
| Conservative | ×1.06 | ×1.35    | ×1.40    | ×1.15            |
| Aggressive   | ×0.94 | ×0.75    | ×0.70    | ×0.90            |


Ordering invariant: conservative ≥ expected ≥ aggressive (elapsed seconds).

---

## Calibration note (early-course bias) — RETRACTED, see #478

The original note read: *"First field use projected first aid ~44 min late. Root cause: treating history mean elapsed/distance as flat GAP, then re-applying Minetti-style hills → double-counted terrain. Fix: softer M(g) + history blend 0.22 / cold blend 0.55."*

**That attribution was wrong, and the micro-model was not the source of the error.** Verified against the deployed database: `pacingEstimateId` is NULL on every race room and `pacing_estimate_json` is empty, so no estimate has ever been generated or attached. Every schedule observed in the field came from the fallback path instead — `plannedPaceSecondsPerKm` (the hardcoded 6:00/km default, since planned course GPX carries no timestamps) plus `buildPlanBaselineFromModel`.

The real cause was that fallback's climb penalty of 8 s per meter of gain, roughly double a defensible running value. On a nearly flat 50 km with 348 m of gain it alone added 46 minutes. Corrected to 3.6 s/m in #478.

**Consequence for the constants below:** the softened `M(g)` and the history blend of 0.22 were fitted to an error produced by a different code path, so neither is validated by field evidence. Both should be reverted and re-derived against a backtest harness before being trusted.

---

## Approval

- [x] Cold-start GAP (10:00/mi)
- [x] Surface held at 1.0
- [ ] Grade / downhill / altitude formulas (+ blend) — **calibration retracted (#478); revert and re-derive from a backtest harness, then re-approve**
- [x] Fatigue \gamma_1, \gamma_2
- [x] Scenario knob table
