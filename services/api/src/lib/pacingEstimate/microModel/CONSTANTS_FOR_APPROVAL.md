# Micro-model constants — for approval

Proposed numeric defaults for the physiology pacing estimator. Treat as provisional until signed off.

**Source of truth:** `[constants.ts](./constants.ts)`

---

## Baseline & course mesh


| Constant                  | Value                         | Role                                                       |
| ------------------------- | ----------------------------- | ---------------------------------------------------------- |
| Cold-start GAP            | **10:00 / mi** (600 s/mi)     | Grade-adjusted flat pace when there is no usable history   |
| Surface C_i               | **1.0**                       | Surface factor disabled until a reliable map source exists |
| Micro-segment target      | **100 m**                     | Route mesh step for slope / altitude samples               |
| Terrain efficiency E(g)   | **1.0**                       | No athlete-specific slope fit (summaries only this epic)   |
| History similarity window | **0.02×–2.0×** course distance, ≥ **5 km** absolute | Wide enough for weekday training on 100–250 mi races |
| Prefer longer when available | Prefer activities ≥ **20 km** (~12.4 mi) if any exist | Else use the full wide window |


---

## Grade & altitude


| Constant              | Value                                                                        | Role                                          |
| --------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| Minetti-relative M(g) | 1 + 3.6g + 14g^2 + 22g^3 (clamped)                                           | Metabolic cost vs flat; g = rise/run          |
| Technical downhill    | g < -15 → **×1.12** extra                                                    | Braking / eccentric penalty on steep descents |
| Altitude F_{alt}      | 1 - 0.01 \times \frac{\mathrm{Alt} - 1500}{300} for Alt > 1500 m; else **1** | Oxygen / altitude slowdown                    |


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

## Approval

- [x] Cold-start GAP (10:00/mi)
- [x] Surface held at 1.0
- [x] Grade / downhill / altitude formulas
- [x] Fatigue \gamma_1, \gamma_2
- [x] Scenario knob table