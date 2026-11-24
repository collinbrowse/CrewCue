/**
 * Slice 2 of docs/product/run-import-and-grade-curve-scope.md: does a runner's own climbing and
 * descending (beyond the shared grade-cost curve) carry from one half of a race to the other?
 *
 * Each aid-to-aid section's terrain is split, from the course GPX, into the shared curve's cost on
 * flat, runnable climb, hiking-grade climb, runnable descent and steep descent. A runner's section
 * time is compared with the median of finishers with a similar finish in the same event, which
 * takes out night, aid stops, course quirks and the field's usual fade. What's left, per section, is
 * how much faster or slower this runner was than similar runners there.
 *
 * Personal model: that deviation = level + Σ βⱼ · (share of the section's cost in terrain class j),
 * fitted on the first half with ridge shrinkage. Shared model: level only. Both predict the
 * second half. Ridge strength is chosen leave-one-course-out.
 *
 * OpenSplitTime has no cadence, so "hiking-grade climb" is a grade class (12% and steeper), not
 * observed hiking. The switch grade itself can't be tested here.
 */
import { geodesicCumulativeAtVertices } from "@crewcue/map-core";
import { gradeCostMultiplier } from "../../src/lib/pacingEstimate/microModel/simulate.js";
import type { BacktestData, CoursePlan, Effort } from "./data.js";
import { out } from "./score.js";
import { SeededRandom, accumulate, emptyNormal, mean, median, solve } from "./stats.js";

export const TERRAIN_CLASSES = ["runnable climb", "hiking-grade climb", "runnable descent", "steep descent"] as const;
const STEP_METERS = 5;
const SMOOTH_METERS = 30;
const FLAT_MAX = 0.04;
const STEEP_CLIMB_MIN = 0.12;
const STEEP_DESCENT_MAX = -0.15;
const COHORT_SIZE = 30;
const FADE_SCALE = 50;
const RIDGE_GRID = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30] as const;

function terrainClass(grade: number): number {
  if (grade >= STEEP_CLIMB_MIN) return 1;
  if (grade >= FLAT_MAX) return 0;
  if (grade <= STEEP_DESCENT_MAX) return 3;
  if (grade <= -FLAT_MAX) return 2;
  return -1;
}

/** Per section: the share of its shared-curve cost in each terrain class (flat is the rest). */
export function sectionTerrainShares(plan: CoursePlan, boundaries: readonly number[]): number[][] {
  const route = plan.route.filter((p) => typeof p.elevationMeters === "number");
  const cumulative = geodesicCumulativeAtVertices(route);
  const total = cumulative[cumulative.length - 1] ?? 0;
  const grid: number[] = [];
  let seg = 0;
  for (let m = 0; m <= total; m += STEP_METERS) {
    while (seg + 1 < cumulative.length - 1 && cumulative[seg + 1]! <= m) seg += 1;
    const a = route[seg]!;
    const b = route[seg + 1] ?? a;
    const span = (cumulative[seg + 1] ?? cumulative[seg]!) - cumulative[seg]!;
    const t = span > 0 ? Math.min(1, (m - cumulative[seg]!) / span) : 0;
    grid.push(a.elevationMeters! + (b.elevationMeters! - a.elevationMeters!) * t);
  }
  const half = Math.round(SMOOTH_METERS / 2 / STEP_METERS);
  const prefix = [0];
  for (const z of grid) prefix.push(prefix[prefix.length - 1]! + z);
  const smooth = grid.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(grid.length - 1, i + half);
    return (prefix[hi + 1]! - prefix[lo]!) / (hi - lo + 1);
  });

  // GPX distance can differ a little from the plan's; scale section boundaries onto this route.
  const scale = total / (boundaries[boundaries.length - 1] || total);
  const sections = boundaries.length - 1;
  const cost = Array.from({ length: sections }, () => [0, 0, 0, 0, 0]);
  let k = 0;
  for (let i = 0; i + 1 < smooth.length; i += 1) {
    const mid = (i + 0.5) * STEP_METERS;
    while (k < sections - 1 && mid > boundaries[k + 1]! * scale) k += 1;
    const grade = (smooth[i + 1]! - smooth[i]!) / STEP_METERS;
    const c = STEP_METERS * gradeCostMultiplier(grade, 1, 1);
    cost[k]![terrainClass(grade) + 1]! += c;
  }
  return cost.map((row) => {
    const sum = row.reduce((s, v) => s + v, 0) || 1;
    return row.slice(1).map((v) => v / sum);
  });
}

type Runner = {
  course: string;
  /** Per section: log(section share of finish) − cohort median of the same. */
  y: number[];
  /** Per section terrain shares (4 classes). */
  f: number[][];
  /** Per section: is the midpoint in the first half of the course? */
  firstHalf: boolean[];
  /** Per section: midpoint as a share of the course. */
  progress: number[];
  /** Per section: cohort-median section time scaled to this runner's finish (s). */
  ref: number[];
  actual: number[];
};

function buildRunners(data: BacktestData): Runner[] {
  const runners: Runner[] = [];
  for (const course of data.courses) {
    const plan = data.plansByCourse.get(course)!;
    const efforts = data.byCourse.get(course) ?? [];
    if (efforts.length === 0) continue;
    const gpxD = efforts[0]!.gpxD;
    const f = sectionTerrainShares(plan, gpxD);
    const len = gpxD[gpxD.length - 1]!;
    const progress = gpxD.slice(1).map((d, k) => (gpxD[k]! + d) / 2 / len);
    const firstHalf = progress.map((x) => x <= 0.5);
    const byEvent = new Map<string, Effort[]>();
    for (const e of efforts) byEvent.set(e.eventId, [...(byEvent.get(e.eventId) ?? []), e]);
    for (const field of byEvent.values()) {
      const logShares = field.map((e) => {
        const finish = e.a[e.a.length - 1]!;
        return e.a.slice(1).map((t, k) => Math.log((t - e.a[k]!) / finish));
      });
      field.forEach((e, idx) => {
        const finish = e.a[e.a.length - 1]!;
        const cohort = field
          .map((other, j) => ({ j, gap: Math.abs(Math.log(other.a[other.a.length - 1]! / finish)) }))
          .filter((c) => c.j !== idx)
          .sort((p, q) => p.gap - q.gap)
          .slice(0, COHORT_SIZE)
          .map((c) => c.j);
        if (cohort.length < 5) return;
        const refLog = logShares[idx]!.map((_, k) => median(cohort.map((j) => logShares[j]![k]!)));
        runners.push({
          course,
          y: logShares[idx]!.map((v, k) => v - refLog[k]!),
          f,
          firstHalf,
          progress,
          ref: refLog.map((v) => finish * Math.exp(v)),
          actual: e.a.slice(1).map((t, k) => t - e.a[k]!)
        });
      });
    }
  }
  return runners;
}

/**
 * Fit level (+ terrain βs unless shared) on the chosen sections. With `fade`, a within-half fade
 * slope is fitted too (returned last), so a runner who slows late isn't read as a poor climber
 * just because the climbs come late in that half. Fade is a control only; predictions don't
 * extrapolate it (the projection backtest found extrapolated fade doesn't help).
 */
function fit(r: Runner, use: boolean[], ridge: number, shared: boolean, fade = false): number[] {
  const used = r.progress.filter((_, s) => use[s]);
  const center = mean(used);
  const k = (shared ? 1 : 1 + TERRAIN_CLASSES.length) + (fade ? 1 : 0);
  const eq = emptyNormal(k);
  r.y.forEach((y, s) => {
    if (!use[s]) return;
    const x = shared ? [1] : [1, ...r.f[s]!];
    // Scaled up so the shared ridge penalty (ridge·n on every non-intercept term) barely touches it.
    if (fade) x.push(FADE_SCALE * (r.progress[s]! - center));
    accumulate(eq, x, y);
  });
  const fallback = [mean(r.y.filter((_, s) => use[s])), ...new Array<number>(k - 1).fill(0)];
  const coef = solve(eq, shared && !fade ? 0 : ridge) ?? fallback;
  return coef;
}

function predict(r: Runner, s: number, coef: number[]): number {
  let sum = coef[0]!;
  for (let j = 0; j < TERRAIN_CLASSES.length && j + 1 < coef.length; j += 1) sum += coef[j + 1]! * r.f[s]![j]!;
  return sum;
}

type HalfScore = { sectionMinutes: number; halfMinutes: number; n: number };

/** Second-half error: mean |section time error| and |second-half total error|, in minutes. */
function scoreSecondHalf(runners: readonly Runner[], ridge: number, shared: boolean): HalfScore {
  let sectionErr = 0;
  let sections = 0;
  let halfErr = 0;
  for (const r of runners) {
    const coef = fit(r, r.firstHalf, ridge, shared);
    let predicted = 0;
    let actual = 0;
    r.y.forEach((_, s) => {
      if (r.firstHalf[s]) return;
      const p = r.ref[s]! * Math.exp(predict(r, s, coef));
      sectionErr += Math.abs(p - r.actual[s]!);
      sections += 1;
      predicted += p;
      actual += r.actual[s]!;
    });
    halfErr += Math.abs(predicted - actual);
  }
  return {
    sectionMinutes: sections > 0 ? sectionErr / sections / 60 : NaN,
    halfMinutes: runners.length > 0 ? halfErr / runners.length / 60 : NaN,
    n: runners.length
  };
}

function correlation(xs: readonly number[], ys: readonly number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i]! - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  });
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/**
 * Method check: give every runner a known personal β per class (σ = PLANT_SIGMA, log scale) on top
 * of their real data. If the method works, the personal model should gain and the split-half
 * correlation should rise well above 0.
 */
const PLANT_SIGMA = 0.15;
function planted(runners: readonly Runner[]): Runner[] {
  const rng = new SeededRandom(20261124);
  return runners.map((r) => {
    const beta = TERRAIN_CLASSES.map(() => PLANT_SIGMA * rng.gauss());
    const y = r.y.map((v, s) => v + beta.reduce((sum, b, j) => sum + b * r.f[s]![j]!, 0));
    return { ...r, y, actual: r.ref.map((ref, s) => ref * Math.exp(y[s]!)) };
  });
}

function halfGain(runners: readonly Runner[], ridge: number): string {
  const shared = scoreSecondHalf(runners, ridge, true).halfMinutes;
  const personal = scoreSecondHalf(runners, ridge, false).halfMinutes;
  return `${fmt(shared)} → ${fmt(personal)} min`;
}

const fmt = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : "–");

export function personalTerrain(data: BacktestData): void {
  const runners = buildRunners(data);
  const courses = [...new Set(runners.map((r) => r.course))].sort();
  out("Personal climbing and descent vs the shared curve (fit first half, predict second half).");
  out("Each runner is compared with the 30 finishers nearest their finish time in the same event.");
  out("");

  // Terrain mix per course (whole course), so the reader sees what each course can test.
  out("Terrain mix (share of shared-curve cost): runnable climb / hiking-grade climb / runnable descent / steep descent");
  for (const course of courses) {
    const r = runners.find((x) => x.course === course)!;
    const shares = TERRAIN_CLASSES.map((_, j) => mean(r.f.map((row) => row[j]!)));
    out(`  ${course.padEnd(24)} ${shares.map((v) => (v * 100).toFixed(0).padStart(3) + "%").join("  ")}`);
  }
  out("");

  // Ridge strength held out one course at a time.
  out("Second half, held out one course at a time (ridge picked on the other courses):");
  out(`  ${"course".padEnd(24)} ${"runners".padStart(7)}  ${"section err (min)".padStart(24)}  ${"2nd-half err (min)".padStart(24)}  ridge`);
  out(`  ${"".padEnd(24)} ${"".padStart(7)}  ${"shared → personal".padStart(24)}  ${"shared → personal".padStart(24)}`);
  const totals = { shared: { s: 0, h: 0 }, personal: { s: 0, h: 0 }, n: 0 };
  for (const course of courses) {
    const train = runners.filter((r) => r.course !== course);
    const test = runners.filter((r) => r.course === course);
    const pool = train.length > 0 ? train : test;
    const ridge = [...RIDGE_GRID].sort(
      (p, q) => scoreSecondHalf(pool, p, false).halfMinutes - scoreSecondHalf(pool, q, false).halfMinutes
    )[0]!;
    const shared = scoreSecondHalf(test, ridge, true);
    const personal = scoreSecondHalf(test, ridge, false);
    totals.shared.s += shared.sectionMinutes * test.length;
    totals.shared.h += shared.halfMinutes * test.length;
    totals.personal.s += personal.sectionMinutes * test.length;
    totals.personal.h += personal.halfMinutes * test.length;
    totals.n += test.length;
    out(
      `  ${course.padEnd(24)} ${String(test.length).padStart(7)}  ${`${fmt(shared.sectionMinutes)} → ${fmt(personal.sectionMinutes)}`.padStart(24)}  ${`${fmt(shared.halfMinutes)} → ${fmt(personal.halfMinutes)}`.padStart(24)}  ${ridge}`
    );
  }
  if (totals.n > 0) {
    const n = totals.n;
    out(
      `  ${"all".padEnd(24)} ${String(n).padStart(7)}  ${`${fmt(totals.shared.s / n)} → ${fmt(totals.personal.s / n)}`.padStart(24)}  ${`${fmt(totals.shared.h / n)} → ${fmt(totals.personal.h / n)}`.padStart(24)}`
    );
  }
  out("");

  const check = planted(runners);
  out(`Method check, planted βs (σ ${PLANT_SIGMA}): second-half error ${halfGain(check, 0.3)} (real data: ${halfGain(runners, 0.3)}), ridge 0.3.`);
  out("");

  // Is it a trait? Split-half reliability of each β, within course.
  out("Is it a trait? Correlation of each runner's β fitted on the first half vs the second half");
  out("(within course, ridge 0.3, each half with its own fade slope; near 0 means noise, not a trait;");
  out("noise alone stays within about ±2/√runners, shown as ±):");
  for (const course of courses) {
    const rs = runners.filter((r) => r.course === course);
    const first = rs.map((r) => fit(r, r.firstHalf, 0.3, false, true));
    const second = rs.map((r) => fit(r, r.firstHalf.map((v) => !v), 0.3, false, true));
    const cors = TERRAIN_CLASSES.map((_, j) =>
      correlation(
        first.map((c) => c[j + 1]!),
        second.map((c) => c[j + 1]!)
      )
    );
    out(`  ${course.padEnd(24)} ${TERRAIN_CLASSES.map((name, j) => `${name} ${fmt(cors[j]!, 2)}`).join("   ")}   ±${fmt(2 / Math.sqrt(rs.length), 2)}`);
  }
  out("");
  out("Same correlation with planted βs (should be clearly positive where a course has that terrain):");
  for (const course of courses) {
    const rs = check.filter((r) => r.course === course);
    const first = rs.map((r) => fit(r, r.firstHalf, 0.3, false, true));
    const second = rs.map((r) => fit(r, r.firstHalf.map((v) => !v), 0.3, false, true));
    const cors = TERRAIN_CLASSES.map((_, j) =>
      correlation(
        first.map((c) => c[j + 1]!),
        second.map((c) => c[j + 1]!)
      )
    );
    out(`  ${course.padEnd(24)} ${TERRAIN_CLASSES.map((name, j) => `${name} ${fmt(cors[j]!, 2)}`).join("   ")}`);
  }
}
