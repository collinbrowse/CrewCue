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

## Calibration note (early-course bias)

First field use projected first aid ~44 min late. Root cause: treating history mean elapsed/distance as flat GAP, then re-applying Minetti-style hills → double-counted terrain. Fix: softer M(g) + history blend **0.22** / cold blend **0.55**.

---

## Approval

- [x] Cold-start GAP (10:00/mi)
- [x] Surface held at 1.0
- [ ] Grade / downhill / altitude formulas (+ blend) — field calibration; needs product re-approval
- [x] Fatigue \gamma_1, \gamma_2
- [x] Scenario knob table
