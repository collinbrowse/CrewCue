/**
 * Projection formulas the backtest scores, in ONE module so PR 3 can swap each for a production
 * call (`services/api/src/lib/raceProjection.ts`, `microModel/`) without touching the analyses.
 *
 * - `anchoredEta` is today's server finish ETA. `parity.ts` checks it against
 *   `recomputeRaceProjection` on the fixture, so the baseline is the real code's behavior.
 * - Everything else here is not in production yet (PR 3–5). The constants are the provisional
 *   Nov 3–4 values fit on OST-heavy data; production keeps them behind `PROJECTION_TUNED_CONSTANTS`.
 *
 * Conventions shared by every function: `d[i]` is distance (m) at checkpoint i, `a[i]` actual
 * elapsed (s), `P[i]` planned elapsed (s); i = 0 is the start and n = d.length − 1 the finish.
 * `k` is the last checkpoint reached and `j` the checkpoint being predicted (j > k).
 */

/** Recency half-life of the live ratio (m). */
export const LIVE_RATIO_HALF_LIFE_METERS = 40_000;
/** Fixed plan trust (approved first pass), tuned at plan σ 0.12. */
export const FIXED_PLAN_TRUST = 0.3;
/** trust = LIVE_TRUST_VARIANCE / σ²; 0.3 · 0.12² so σ 0.12 gives the fixed 0.3. */
export const LIVE_TRUST_VARIANCE = FIXED_PLAN_TRUST * 0.12 ** 2;
/** Late-race slowdown slope applied to the plan shape. */
export const SLOWDOWN_SLOPE_DEFAULT = 0.24;
/** Section-time factor while the sun is below CIVIL_TWILIGHT_DEGREES. */
export const NIGHT_PACE_FACTOR = 1.06;
export const CIVIL_TWILIGHT_DEGREES = -6;
/** Provisional 3-term progress-bias layer [A, B·seen, C·ln(ratio)·(1 − w)]. */
export const LIVE_BIAS_DEFAULT: readonly [number, number, number] = [0.09, -0.21, 0.36];

export type Series = { d: readonly number[]; a: readonly number[] };

/** Recency-weighted actual / plan section time over checkpoints 1..k. */
export function ewmaRatio(
  { d, a }: Series,
  P: readonly number[],
  k: number,
  halfLifeMeters = LIVE_RATIO_HALF_LIFE_METERS
): number {
  let num = 0;
  let den = 0;
  for (let i = 1; i <= k; i += 1) {
    const w = 0.5 ** ((d[k]! - (d[i - 1]! + d[i]!) / 2) / halfLifeMeters);
    num += w * (a[i]! - a[i - 1]!);
    den += w * (P[i]! - P[i - 1]!);
  }
  return num / den;
}

export function progressSeen({ d }: Series, k: number): number {
  return d[k]! / d[d.length - 1]!;
}

/** Plan only (no live data). */
export function planOnlyEta(P: readonly number[], j: number): number {
  return P[j]!;
}

/** Today's server: actual at the last checkpoint plus the plan's remaining time. */
export function anchoredEta(series: Series, P: readonly number[], k: number, j: number): number {
  return series.a[k]! + Math.max(0, P[j]! - P[k]!);
}

/** Blend weight on the live ratio after `seen` of the course with plan `trust`. */
export function liveWeight(seen: number, trust: number): number {
  return seen / (seen + trust);
}

export function trustFromPlanSigma(planLogSigma: number): number {
  return LIVE_TRUST_VARIANCE / planLogSigma ** 2;
}

/** B0: a[k] + r · (P[j] − P[k]), r = 1 + w · (ratio − 1). */
export function ratioEta(series: Series, P: readonly number[], k: number, j: number, trust = FIXED_PLAN_TRUST): number {
  const w = liveWeight(progressSeen(series, k), trust);
  const r = 1 + w * (ewmaRatio(series, P, k) - 1);
  return series.a[k]! + r * (P[j]! - P[k]!);
}

/** Pieces of B0 in log space, shared by the bias layer and the learned residuals. */
export function ratioParts(series: Series, P: readonly number[], k: number, trust: number) {
  const seen = progressSeen(series, k);
  const w = liveWeight(seen, trust);
  const logRatio = Math.max(-1, Math.min(1, Math.log(ewmaRatio(series, P, k))));
  const logBase = Math.log(Math.max(0.2, 1 + w * (Math.exp(logRatio) - 1)));
  return { seen, w, logRatio, logBase };
}

export function biasLayerFeatures(seen: number, w: number, logRatio: number): [number, number, number] {
  return [1, seen, logRatio * (1 - w)];
}

/** PR 3: r_rem = r · exp(A + B·seen + C·ln(ratio)·(1 − w)). */
export function biasLayerEta(
  series: Series,
  P: readonly number[],
  k: number,
  j: number,
  trust: number,
  betas: readonly number[] = LIVE_BIAS_DEFAULT
): number {
  const { seen, w, logRatio, logBase } = ratioParts(series, P, k, trust);
  const x = biasLayerFeatures(seen, w, logRatio);
  const adj = x.reduce((s, xi, i) => s + xi * betas[i]!, 0);
  return series.a[k]! + Math.exp(logBase + adj) * (P[j]! - P[k]!);
}

/**
 * Past-runners method (the approach OpenSplitTime's site uses, run on whatever course history is
 * loaded; no OST code or data): the remaining time of past finishers who reached checkpoint k at a
 * similar elapsed time. Null when fewer than 4 are close enough.
 */
export function pastRunnersEta(pool: readonly (readonly number[])[], a: readonly number[], k: number, j: number): number | null {
  const ak = a[k]!;
  const near = pool
    .filter((p) => Math.abs(p[k]! / ak - 1) <= 0.3)
    .sort((x, y) => Math.abs(x[k]! - ak) - Math.abs(y[k]! - ak))
    .slice(0, 100);
  if (near.length < 4) {
    return null;
  }
  const rs = near.map((p) => (p[j]! - p[k]!) / p[k]!).sort((x, y) => x - y);
  const q1 = rs[rs.length >> 2]!;
  const q3 = rs[(3 * rs.length) >> 2]!;
  const iqr = q3 - q1;
  const kept = rs.filter((r) => r >= q1 - 1.5 * iqr && r <= q3 + 1.5 * iqr);
  const use = kept.length > 0 ? kept : rs;
  return ak * (1 + use.reduce((s, r) => s + r, 0) / use.length);
}

/** Plan from past finishers of similar planned finish: their median share of finish time per checkpoint. */
export function cohortPlan(pool: readonly (readonly number[])[], plannedFinish: number, length: number): number[] {
  let near = pool.filter((p) => Math.abs(p[p.length - 1]! / plannedFinish - 1) <= 0.1);
  if (near.length < 5) {
    near = [...pool]
      .sort((x, y) => Math.abs(x[x.length - 1]! - plannedFinish) - Math.abs(y[y.length - 1]! - plannedFinish))
      .slice(0, 10);
  }
  return Array.from({ length }, (_, i) => {
    const shares = near.map((p) => p[i]! / p[p.length - 1]!).sort((x, y) => x - y);
    const mid = shares.length >> 1;
    const med = shares.length % 2 ? shares[mid]! : (shares[mid - 1]! + shares[mid]!) / 2;
    return med * plannedFinish;
  });
}

/**
 * Re-weight a cumulative plan's sections by `factor(progressMid)` and renormalize to the same total.
 * The linear slowdown fix is factor = 1 + s·(progressMid − 0.5).
 */
export function reshapePlan(P: readonly number[], d: readonly number[], factor: (progressMid: number) => number): number[] {
  const L = d[d.length - 1]!;
  const sections = P.slice(1).map((p, idx) => (p - P[idx]!) * factor((d[idx]! + d[idx + 1]!) / 2 / L));
  const scale = P[P.length - 1]! / sections.reduce((s, v) => s + v, 0);
  const out = [0];
  for (const section of sections) {
    out.push(out[out.length - 1]! + section * scale);
  }
  return out;
}

export function slowdownPlan(P: readonly number[], d: readonly number[], slope = SLOWDOWN_SLOPE_DEFAULT): number[] {
  return reshapePlan(P, d, (x) => 1 + slope * (x - 0.5));
}

/** NOAA solar elevation approximation (degrees). PR 3 adds the production `sunElevationDegrees`. */
export function sunElevationDegrees(date: Date, latitude: number, longitude: number): number {
  const rad = Math.PI / 180;
  const n = date.getTime() / 86_400_000 + 2440587.5 - 2451545.0;
  const L = (((280.46 + 0.9856474 * n) % 360) + 360) % 360;
  const g = ((((357.528 + 0.9856003 * n) % 360) + 360) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const ha = (gmst * 15 + longitude - ra / rad) * rad;
  const la = latitude * rad;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / rad;
}

/** Share of [t0, t1] (seconds after `start`) with the sun below civil twilight, sampled every ~5 min. */
export function darkShare(start: Date, t0: number, t1: number, latitude: number, longitude: number): number {
  const steps = Math.max(2, Math.floor((t1 - t0) / 300));
  let dark = 0;
  for (let i = 0; i < steps; i += 1) {
    const t = start.getTime() + (t0 + ((i + 0.5) * (t1 - t0)) / steps) * 1000;
    if (sunElevationDegrees(new Date(t), latitude, longitude) < CIVIL_TWILIGHT_DEGREES) {
      dark += 1;
    }
  }
  return dark / steps;
}
