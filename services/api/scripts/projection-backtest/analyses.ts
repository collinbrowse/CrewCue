/**
 * Ports of the Nov 3–4 reference scripts (~/.claude/plans/dynamic-giggling-hippo-backtest/), one
 * function each, plus `headline` (the default report). Each prints to stdout.
 *
 * Fitted pieces are leave-one-course-out (LOCO): a course is always scored with constants fit on
 * the OTHER courses. With a single course there is nothing to hold out and those rows print "-".
 */
import { rescaleLevel, type BacktestData, type Effort } from "./data.js";
import {
  FIXED_PLAN_TRUST,
  LIVE_BIAS_DEFAULT,
  LIVE_TRUST_VARIANCE,
  darkShare,
  ewmaRatio,
  pastRunnersEta,
  cohortPlan,
  reshapePlan,
  trustFromPlanSigma
} from "./formulas.js";
import {
  PROGRESS_BUCKETS,
  anchored,
  biasLayer,
  bucketLabel,
  courseTable,
  finishError,
  fitLoco,
  fmt,
  logRemainingRatio,
  methodTable,
  out,
  plan,
  predictionPairs,
  ratio,
  score,
  type FitRow,
  type Predictor
} from "./score.js";
import { SeededRandom, accumulate, clamp, crc32, emptyNormal, mean, median, pvariance, slope, solve } from "./stats.js";

const LONG_COURSE_METERS = 90_000;
const MIXED_SIGMAS = [0.07, 0.14, 0.28] as const;

function longCourses(data: BacktestData): string[] {
  return data.courses.filter((c) => data.plansByCourse.get(c)!.lengthMeters >= LONG_COURSE_METERS);
}

function effortsOf(data: BacktestData, courses: readonly string[]): Effort[] {
  return courses.flatMap((c) => data.byCourse.get(c) ?? []);
}

const past: Predictor = (e, k, j) => pastRunnersEta(e.cohortPool, e.a, k, j);

/** Per-runner plan σ for the mixed field: a stable third each at 0.07 / 0.14 / 0.28. */
function mixedSigma(e: Effort): number {
  return MIXED_SIGMAS[crc32(`${e.eventId}|${e.a[e.a.length - 1]}|${e.a[1]}`) % 3]!;
}

function ensureMixedPlan(data: BacktestData): void {
  if (!data.efforts[0]?.plans.Pmix) {
    rescaleLevel(data.efforts, mixedSigma, "gpxFade", "Pmix");
  }
}

// ---------- default report ----------

export function headline(data: BacktestData): void {
  const trust = trustFromPlanSigma(data.planSigma);
  const server = anchored("gpx");
  const b0 = ratio("gpxFade");
  const pr3 = biasLayer(data, "gpxFade", () => trust).fn;
  const methods: Array<[string, Predictor]> = [
    ["server today", server],
    ["B0 (live ratio, trust 0.3)", b0],
    [`PR 3 (trust ${trust.toFixed(2)} + bias)`, pr3],
    ["PR 3, provisional A/B/C", biasLayer(data, "gpxFade", () => trust, LIVE_BIAS_DEFAULT).fn]
  ];

  out(`Projection backtest: ${data.efforts.length} finishers, ${data.courses.length} courses. Average minutes off.`);
  out(`Plan = production micro-model shape; plan level = actual finish × exp(${data.planSigma}·z) (synthetic plan error).`);
  out(
    `Slowdown fix per course (held-out fit): ${data.courses.map((c) => `${c} ${data.slowdownByCourse.get(c)!.toFixed(2)}`).join(", ")}`
  );

  out(`PR 3 = trust from plan σ (${trust.toFixed(2)} here) plus the 3-term bias layer, fit leave-one-course-out on this data;`);
  out(`"provisional A/B/C" uses the Nov 4 constants (${LIVE_BIAS_DEFAULT.join(", ")}) as PR 3 ships them, behind PROJECTION_TUNED_CONSTANTS.`);
  out("\n1. By course: next aid / finish");
  out(`  ${"course".padEnd(26)}${"runners".padStart(8)}${methods.map(([l]) => ` ${l}`.padStart(28)).join("")}`);
  const rowFor = (label: string, efforts: Effort[]) =>
    out(
      `  ${label.slice(0, 26).padEnd(26)}${String(efforts.length).padStart(8)}${methods
        .map(([, fn]) => {
          const s = score(fn, efforts);
          return `${fmt(s.nextAid, 10)} / ${fmt(s.finish, 9)}`.padStart(28);
        })
        .join("")}`
    );
  for (const course of data.courses) {
    rowFor(course, data.byCourse.get(course)!);
  }
  rowFor("all runners", data.efforts);

  out("\n2. By race progress (finish error, all runners)");
  out(`  ${"method".padEnd(54)}${PROGRESS_BUCKETS.map((b) => bucketLabel(b).padStart(9)).join("")}`);
  for (const [label, fn] of methods) {
    out(`  ${label.padEnd(54)}${PROGRESS_BUCKETS.map(([lo, hi]) => fmt(finishError(fn, data.efforts, lo, hi), 9)).join("")}`);
  }

  out("\n3. Next aid (all runners)");
  for (const [label, fn] of methods) {
    out(`  ${label.padEnd(54)}${fmt(score(fn, data.efforts).nextAid, 7)}`);
  }

  ensureMixedPlan(data);
  const perRunner = (e: Effort) => trustFromPlanSigma(mixedSigma(e));
  out(`\n4. Mixed plan-quality field (a third each at plan σ ${MIXED_SIGMAS.join(" / ")}): next aid / finish`);
  for (const [label, fn] of [
    ["fixed trust 0.3", ratio("Pmix")],
    ["per-runner trust from its σ", ratio("Pmix", perRunner)],
    ["fixed trust 0.3 + bias layer", biasLayer(data, "Pmix", () => FIXED_PLAN_TRUST).fn],
    ["per-runner trust + bias layer (PR 3)", biasLayer(data, "Pmix", perRunner).fn]
  ] as Array<[string, Predictor]>) {
    const s = score(fn, data.efforts);
    out(`  ${label.padEnd(54)}${fmt(s.nextAid, 7)} / ${fmt(s.finish, 7)}`);
  }
}

// ---------- gpx_backtest.py ----------

export function gpxBacktest(data: BacktestData): void {
  out(`plan error sigma=${data.planSigma}; errors are average minutes off`);
  for (const c of data.courses) {
    const sub = data.byCourse.get(c)!;
    out(`${c}: ${sub.length} runners in ${new Set(sub.map((e) => e.eventId)).size} races`);
  }
  const both = data.efforts.filter((e) => e.plans.cohort);
  methodTable("A. SAME RUNNERS, all three plans available", both, [
    ["server today, GPX plan", anchored("gpx")],
    ["server today, past-runners plan", anchored("cohort")],
    ["proposed (whole-race ratio, trust 0.05), GPX plan", ratio("gpx", 0.05)],
    ["proposed (whole-race ratio, trust 0.05), past-runners plan", ratio("cohort", 0.05)],
    ["proposed (whole-race ratio, trust 0.05), flat plan", ratio("flat", 0.05)],
    ["past-runners method (no plan, past results)", past],
    ["pre-race GPX plan only (no live data)", plan("gpx")]
  ]);
  methodTable("B. ALL RUNNERS on GPX courses (incl. races with no prior years)", data.efforts, [
    ["server today, GPX plan", anchored("gpx")],
    ["proposed (trust 0.05), GPX plan", ratio("gpx", 0.05)],
    ["proposed (trust 0.05), flat plan", ratio("flat", 0.05)]
  ]);
  for (const c of data.courses) {
    const sub = data.byCourse.get(c)!;
    const rows: Array<[string, Predictor]> = [
      ["server today, GPX plan", anchored("gpx")],
      ["proposed, GPX plan", ratio("gpx", 0.05)]
    ];
    if (sub.length > 0 && sub.every((e) => e.plans.cohort)) {
      rows.push(["proposed, past-runners plan", ratio("cohort", 0.05)]);
    }
    methodTable(`C. ${c}`, sub, rows);
  }
}

// ---------- gpx_fade.py ----------

export function gpxFade(data: BacktestData): void {
  out("fitted slowdown slope per held-out course (extra time per unit of race progress):");
  out(`  ${data.courses.map((c) => `${c} ${data.slowdownByCourse.get(c)!.toFixed(2)}`).join(", ")}`);
  const both = data.efforts.filter((e) => e.plans.cohort);
  methodTable("SAME RUNNERS as before", both, [
    ["server today, GPX plan", anchored("gpx")],
    ["proposed, GPX plan (as-is)", ratio("gpx", 0.05)],
    ["server today, GPX plan + slowdown fix", anchored("gpxFade")],
    ["proposed, GPX plan + slowdown fix", ratio("gpxFade", 0.05)],
    ["proposed, past-runners plan", ratio("cohort", 0.05)],
    ["past-runners method", past]
  ]);
  for (const c of data.courses) {
    methodTable(c, data.byCourse.get(c)!, [
      ["server today, GPX plan", anchored("gpx")],
      ["proposed, GPX plan + slowdown fix", ratio("gpxFade", 0.05)]
    ]);
  }
}

// ---------- night.py ----------

export function night(data: BacktestData): void {
  const rows = new Map<string, Array<[number, number, number]>>(); // course|section -> (rel, dark, logFinish)
  for (const e of data.efforts) {
    const { latitude, longitude } = data.plansByCourse.get(e.course)!.start;
    const p = e.plans.gpxFade!;
    const scale = e.a[e.a.length - 1]! / p[p.length - 1]!;
    for (let i = 1; i < e.a.length; i += 1) {
      const rel = (e.a[i]! - e.a[i - 1]!) / (p[i]! - p[i - 1]!) / scale;
      const key = `${e.course}|${i}`;
      const list = rows.get(key) ?? [];
      list.push([rel, darkShare(e.startTime, e.a[i - 1]!, e.a[i]!, latitude, longitude), Math.log(e.a[e.a.length - 1]!)]);
      rows.set(key, list);
    }
  }
  let num = 0;
  let den = 0;
  const perCourse = new Map<string, [number, number, number]>();
  for (const [key, rs] of rows) {
    const darks = rs.map((r) => r[1]);
    if (rs.length < 30 || pvariance(darks) < 0.02) {
      continue; // nearly everyone ran this section in the same light
    }
    const eq = emptyNormal(3);
    for (const [rel, dark, logF] of rs) {
      accumulate(eq, [1, dark, logF], clamp(rel, 0.33, 3));
    }
    const coef = solve(eq);
    if (!coef) {
      continue;
    }
    const w = rs.length * pvariance(darks);
    num += w * coef[1]!;
    den += w;
    const course = key.split("|")[0]!;
    const pc = perCourse.get(course) ?? [0, 0, 0];
    perCourse.set(course, [pc[0] + w * coef[1]!, pc[1] + w, pc[2] + 1]);
  }
  out("Night effect = extra section time when fully dark vs fully daylight, same section, same-speed runner");
  out(`  pooled over all courses: ${den > 0 ? `${((100 * num) / den).toFixed(1)}%` : "- (no section with a day/night mix and 30+ runners)"}`);
  for (const [c, [n, d, k]] of [...perCourse].sort()) {
    out(`  ${c.padEnd(26)} ${((100 * n) / d).toFixed(1).padStart(6)}%   (${k} sections with day/night mix)`);
  }
  const dayAll: number[] = [];
  const darkAll: number[] = [];
  for (const rs of rows.values()) {
    const day = rs.filter((r) => r[1] < 0.2).map((r) => r[0]);
    const drk = rs.filter((r) => r[1] > 0.8).map((r) => r[0]);
    if (day.length >= 20 && drk.length >= 20) {
      dayAll.push(median(day));
      darkAll.push(median(drk));
    }
  }
  if (dayAll.length > 0) {
    out(
      `\nDescriptive check: ${dayAll.length} sections, mostly-daylight median ${mean(dayAll).toFixed(2)}, mostly-dark ${mean(darkAll).toFixed(2)}` +
        ` -> ${(100 * (mean(darkAll) / mean(dayAll) - 1)).toFixed(0)}% (not speed-adjusted)`
    );
  }
}

// ---------- prior_sweep.py ----------

export function priorSweep(data: BacktestData): void {
  const PRIORS = [0.05, 0.1, 0.2, 0.3, 0.5];
  const tab = new Map(
    data.courses.map((c) => {
      const sub = data.byCourse.get(c)!;
      return [c, { server: score(anchored("gpx"), sub), byPrior: PRIORS.map((p) => score(ratio("gpxFade", p), sub)) }];
    })
  );
  out("finish error (min) by plan-trust setting; higher = trust plan longer");
  out(`${"course".padEnd(26)}${"server".padStart(9)}${PRIORS.map((p) => String(p).padStart(9)).join("")}`);
  for (const c of data.courses) {
    const t = tab.get(c)!;
    out(`${c.padEnd(26)}${fmt(t.server.finish, 9)}${t.byPrior.map((s) => fmt(s.finish, 9)).join("")}`);
  }
  out("\nleave-one-course-out: setting chosen on the OTHER courses (runner-weighted), scored on this one");
  for (const c of data.courses) {
    const others = data.courses.filter((o) => o !== c);
    if (others.length === 0) {
      out(`  ${c}: - (needs a second course)`);
      continue;
    }
    const weighted = (pi: number) =>
      others.reduce((s, o) => s + tab.get(o)!.byPrior[pi]!.finish * tab.get(o)!.byPrior[pi]!.count, 0) /
      others.reduce((s, o) => s + tab.get(o)!.byPrior[pi]!.count, 0);
    const best = PRIORS.map((_, i) => i).reduce((b, i) => (weighted(i) < weighted(b) ? i : b), 0);
    const t = tab.get(c)!;
    out(
      `  ${c.padEnd(26)} chosen ${PRIORS[best]}: finish ${fmt(t.byPrior[best]!.finish, 6)}  next aid ${fmt(t.byPrior[best]!.nextAid, 5)}` +
        `   (server ${fmt(t.server.finish, 6)} / ${fmt(t.server.nextAid, 5)})`
    );
  }
}

// ---------- fresh_look.py ----------

function sectionPoints(efforts: readonly Effort[], key: string): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of efforts) {
    const g = e.plans[key]!;
    const scale = e.a[e.a.length - 1]! / g[g.length - 1]!;
    for (let i = 1; i < e.a.length; i += 1) {
      xs.push((e.d[i - 1]! + e.d[i]!) / 2 / e.d[e.d.length - 1]!);
      ys.push((e.a[i]! - e.a[i - 1]!) / (g[i]! - g[i - 1]!) / scale);
    }
  }
  return { xs, ys };
}

/** 14 features of the learned live update (fresh_look E4). */
function learnedFeatures(e: Effort, P: readonly number[], k: number, j: number): number[] {
  const { a } = e;
  const n = a.length - 1;
  const cl = (v: number) => clamp(v, -1, 1);
  const seen = e.d[k]! / e.d[n]!;
  const lRc = cl(Math.log(a[k]! / P[k]!));
  const lRe = cl(Math.log(ewmaRatio(e, P, k)));
  const lRl = cl(Math.log((a[k]! - a[k - 1]!) / Math.max(1, P[k]! - P[k - 1]!)));
  const k2 = Math.max(0, k - 3);
  const lR3 = cl(Math.log((a[k]! - a[k2]!) / Math.max(1, P[k]! - P[k2]!)));
  const h = (P[j]! - P[k]!) / P[n]!;
  const hrs = Math.log(P[n]! / 3600 / 24);
  const fade = lR3 - lRc;
  return [1, lRc, lRe, lRl, lR3, seen, seen * lRc, seen * lR3, h, h * lR3, h * fade, hrs, hrs * h, fade];
}

function learnedUpdate(data: BacktestData, planKey: string): { fn: Predictor; betas: Map<string, number[]> } {
  const betas = fitLoco(
    data.courses,
    function* (course): Generator<FitRow> {
      for (const e of data.byCourse.get(course)!) {
        const P = e.plans[planKey]!;
        for (const [k, j] of predictionPairs(e)) {
          if (P[j]! - P[k]! > 0) {
            yield { x: learnedFeatures(e, P, k, j), y: logRemainingRatio(e, P, k, j), w: (P[j]! - P[k]!) / 3600 };
          }
        }
      }
    },
    14,
    1e-3
  );
  return {
    fn: (e, k, j) => {
      const P = e.plans[planKey]!;
      const x = learnedFeatures(e, P, k, j);
      const b = betas.get(e.course)!;
      return e.a[k]! + Math.exp(x.reduce((s, xi, i) => s + xi * b[i]!, 0)) * (P[j]! - P[k]!);
    },
    betas
  };
}

/** 80% finish window: LOCO 10th–90th percentile of log(actual/predicted remaining) per progress bucket. */
function windowTable(data: BacktestData, fn: Predictor, courses: readonly string[], trainOn: readonly string[]): void {
  const res = new Map<string, Array<[number, number, number]>>();
  for (const c of trainOn) {
    const list: Array<[number, number, number]> = [];
    for (const e of data.byCourse.get(c)!) {
      const n = e.a.length - 1;
      for (let k = 1; k < n - 1; k += 1) {
        const p = fn(e, k, n);
        if (p === null) {
          continue;
        }
        const rp = p - e.a[k]!;
        const ra = e.a[n]! - e.a[k]!;
        if (rp > 0 && ra > 0) {
          list.push([e.d[k]! / e.d[n]!, Math.log(ra / rp), rp]);
        }
      }
    }
    res.set(c, list);
  }
  out(`  ${"course".padEnd(26)}${"progress".padStart(9)}${"covered".padStart(9)}  median width (min)`);
  for (const c of courses) {
    for (const bucket of PROGRESS_BUCKETS) {
      const [lo, hi] = bucket;
      const inBucket = (r: [number, number, number]) => r[0] >= lo && r[0] < hi;
      const train = trainOn
        .filter((o) => o !== c)
        .flatMap((o) => res.get(o)!.filter(inBucket).map((r) => r[1]))
        .sort((x, y) => x - y);
      const test = (res.get(c) ?? []).filter(inBucket);
      if (train.length < 10 || test.length === 0) {
        out(`  ${c.slice(0, 26).padEnd(26)}${bucketLabel(bucket).padStart(9)}        -   (needs another course to fit on)`);
        continue;
      }
      const q10 = train[Math.floor(0.1 * train.length)]!;
      const q90 = train[Math.floor(0.9 * train.length)]!;
      const cov = test.filter((r) => r[1] >= q10 && r[1] <= q90).length / test.length;
      const width = median(test.map((r) => (r[2] * (Math.exp(q90) - Math.exp(q10))) / 60));
      out(`  ${c.slice(0, 26).padEnd(26)}${bucketLabel(bucket).padStart(9)}${fmt(100 * cov, 8, 0)}%  ${fmt(width, 8, 0)}`);
    }
  }
}

export function freshLook(data: BacktestData): void {
  const SERVER = anchored("gpx");
  const B0 = ratio("gpxFade");
  const longs = effortsOf(data, longCourses(data));

  out("E1. Finish-ETA error (min) by how far into the race, long courses pooled");
  out("  progress   server     B0(approved)   B0 as % of time still to go");
  for (const [lo, hi] of PROGRESS_BUCKETS) {
    const pct: number[] = [];
    for (const e of longs) {
      const n = e.a.length - 1;
      for (let k = 1; k < n; k += 1) {
        const seen = e.d[k]! / e.d[n]!;
        if (seen >= lo && seen < hi) {
          pct.push((Math.abs(B0(e, k, n)! - e.a[n]!) / (e.a[n]! - e.a[k]!)) * 100);
        }
      }
    }
    out(`  ${bucketLabel([lo, hi]).padEnd(9)}${fmt(finishError(SERVER, longs, lo, hi), 7)}   ${fmt(finishError(B0, longs, lo, hi), 10)}        ${fmt(mean(pct), 5)}%`);
  }

  // E2: oracles.
  rescaleLevel(data.efforts, 0, "gpxFade", "perfectLevel");
  for (const c of data.courses) {
    const sub = data.byCourse.get(c)!;
    if (sub.length === 0) {
      continue;
    }
    const n = sub[0]!.a.length - 1;
    const cum = [0];
    for (let i = 1; i <= n; i += 1) {
      cum.push(cum[i - 1]! + median(sub.map((e) => (e.a[i]! - e.a[i - 1]!) / e.a[n]!)));
    }
    for (const e of sub) {
      e.plans.realShape = cum.map((x) => (x / cum[n]!) * e.plans.gpxFade![n]!);
      e.plans.realShapePerfect = cum.map((x) => (x / cum[n]!) * e.a[n]!);
    }
  }
  for (const e of data.efforts) {
    const { xs, ys } = sectionPoints([e], "gpx");
    const own = slope(xs, ys);
    const cOwn = Number.isFinite(own) ? clamp(own, -0.2, 1) : 0.24;
    e.plans.ownFade = reshapePlan(e.plans.gpx!, e.d, (x) => 1 + cOwn * (x - 0.5));
  }
  courseTable("E2. What if one part of the problem were solved perfectly? (finish error, min)", data.courses, data.byCourse, [
    ["server today", SERVER],
    ["B0 approved formula", B0],
    ["B0 + runner's own fade slope (oracle)", ratio("ownFade")],
    ["B0 + true course shape (oracle)", ratio("realShape")],
    ["B0 + perfect pre-race total (oracle)", ratio("perfectLevel")],
    ["plan only, perfect total, GPX shape", plan("perfectLevel")],
    ["plan only, perfect total, true course shape", plan("realShapePerfect")]
  ]);

  out("\nE3. Best plan-trust setting for different pre-race plan accuracy (finish error, all runners)");
  const PRIORS = [0.05, 0.1, 0.2, 0.3, 0.5, 1.0];
  out(`  plan sigma ${PRIORS.map((p) => String(p).padStart(9)).join("")}`);
  for (const sigma of [0.06, 0.12, 0.2, 0.3]) {
    rescaleLevel(data.efforts, sigma, "gpxFade", "P");
    const row = PRIORS.map((p) => finishError(ratio("P", p), data.efforts));
    out(`  ${sigma.toFixed(2).padStart(9)}  ${row.map((v) => fmt(v, 9)).join("")}   best ${PRIORS[row.indexOf(Math.min(...row))]}`);
  }

  const LEARN = learnedUpdate(data, "gpxFade");
  courseTable("E4. Learned live update vs approved formula (finish error, min; LOCO)", data.courses, data.byCourse, [
    ["server today", SERVER],
    ["B0 approved formula", B0],
    ["learned update, GPX plan", LEARN.fn]
  ]);
  out(
    `\n  next-aid error (min), all runners:  server ${fmt(score(SERVER, data.efforts).nextAid, 0)}   B0 ${fmt(score(B0, data.efforts).nextAid, 0)}   learned ${fmt(score(LEARN.fn, data.efforts).nextAid, 0)}`
  );
  out("\n  learned update, error by progress (long courses pooled):");
  for (const [lo, hi] of PROGRESS_BUCKETS) {
    out(`    ${bucketLabel([lo, hi]).padEnd(8)} B0 ${fmt(finishError(B0, longs, lo, hi), 6)}   learned ${fmt(finishError(LEARN.fn, longs, lo, hi), 6)}`);
  }

  const both = data.efforts.filter((e) => e.plans.cohort);
  const blend: Predictor = (e, k, j) => {
    const o = past(e, k, j);
    const g = LEARN.fn(e, k, j)!;
    return o === null ? g : 0.5 * (o + g);
  };
  out(`\nE5. Runners whose course has prior years (${both.length} runners): finish / next-aid error (min)`);
  for (const [label, fn] of [
    ["B0, GPX plan", B0],
    ["B0, past-runners plan", ratio("cohort")],
    ["past-runners method (past results only)", past],
    ["learned update, GPX plan", LEARN.fn],
    ["50/50 learned GPX + past-runners", blend]
  ] as Array<[string, Predictor]>) {
    const s = score(fn, both);
    out(`  ${label.padEnd(46)} ${fmt(s.finish, 7)}  ${fmt(s.nextAid, 6)}`);
  }

  out("\nE6. 80% window for the finish (learned update; 10th-90th pct of log error, fit LOCO)");
  windowTable(data, LEARN.fn, longCourses(data), data.courses);
}

// ---------- fresh_look2.py ----------

const EDGES = Array.from({ length: 11 }, (_, i) => i / 10);

function binMedians(points: { xs: number[]; ys: number[] }): Array<number | null> {
  return Array.from({ length: 10 }, (_, b) => {
    const ys = points.ys.filter((_, i) => points.xs[i]! >= EDGES[b]! && points.xs[i]! < EDGES[b + 1]!);
    return ys.length >= 30 ? median(ys) : null;
  });
}

function interpolateBins(meds: Array<number | null>): ((x: number) => number) | null {
  const known = meds
    .map((v, b) => [(EDGES[b]! + EDGES[b + 1]!) / 2, v] as const)
    .filter((p): p is readonly [number, number] => p[1] !== null);
  if (known.length === 0) {
    return null;
  }
  return (x) => {
    if (x <= known[0]![0]) {
      return known[0]![1];
    }
    for (let i = 1; i < known.length; i += 1) {
      const [x0, y0] = known[i - 1]!;
      const [x1, y1] = known[i]!;
      if (x <= x1) {
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return known[known.length - 1]![1];
  };
}

/** 10-feature fade-aware residual on top of B0 (fresh_look2 C). */
function residualFeatures(e: Effort, P: readonly number[], k: number, j: number) {
  const { a } = e;
  const n = a.length - 1;
  const cl = (v: number) => clamp(v, -1, 1);
  const seen = e.d[k]! / e.d[n]!;
  const w = seen / (seen + FIXED_PLAN_TRUST);
  const lre = cl(Math.log(ewmaRatio(e, P, k)));
  const k3 = Math.max(0, k - 3);
  const lr3 = cl(Math.log((a[k]! - a[k3]!) / Math.max(1, P[k]! - P[k3]!)));
  const lrc = cl(Math.log(a[k]! / P[k]!));
  const trend = lr3 - lrc;
  const h = (P[j]! - P[k]!) / P[n]!;
  const base = Math.log(Math.max(0.2, 1 + w * (Math.exp(lre) - 1)));
  return {
    base,
    x: [1, seen, h, seen * h, trend, trend * h, trend * seen, lre * (1 - w), lre * seen * (1 - w), lrc - lre]
  };
}

function fadeAwareResidual(data: BacktestData, planKey: string): Predictor {
  const betas = fitLoco(
    data.courses,
    function* (course): Generator<FitRow> {
      for (const e of data.byCourse.get(course)!) {
        const P = e.plans[planKey]!;
        for (const [k, j] of predictionPairs(e)) {
          const { base, x } = residualFeatures(e, P, k, j);
          yield { x, y: logRemainingRatio(e, P, k, j) - base, w: (P[j]! - P[k]!) / 3600 };
        }
      }
    },
    10,
    1e-2
  );
  return (e, k, j) => {
    const P = e.plans[planKey]!;
    const { base, x } = residualFeatures(e, P, k, j);
    const b = betas.get(e.course)!;
    return e.a[k]! + Math.exp(base + x.reduce((s, xi, i) => s + xi * b[i]!, 0)) * (P[j]! - P[k]!);
  };
}

export function freshLook2(data: BacktestData): void {
  const SERVER = anchored("gpx");
  out(`A. Plan trust as a variance ratio: trust = ${LIVE_TRUST_VARIANCE.toFixed(4)} / sigma^2  (finish error, min, all runners)`);
  const PRIORS = [0.05, 0.1, 0.2, 0.3, 0.5, 1.0, 2.0];
  out(`  plan sigma ${PRIORS.map((p) => String(p).padStart(8)).join("")}   rule trust  rule error`);
  for (const sigma of [0.06, 0.12, 0.2, 0.3]) {
    rescaleLevel(data.efforts, sigma, "gpxFade", "P");
    const row = PRIORS.map((p) => finishError(ratio("P", p), data.efforts));
    const rule = finishError(ratio("P", trustFromPlanSigma(sigma)), data.efforts);
    out(`  ${sigma.toFixed(2).padStart(9)}  ${row.map((v) => fmt(v, 8)).join("")}   ${fmt(trustFromPlanSigma(sigma), 9, 2)}   ${fmt(rule, 9)}`);
  }
  ensureMixedPlan(data);
  out(`\n  Mixed field (a third each with plan sigma ${MIXED_SIGMAS.join(" / ")}):`);
  for (const p of [0.1, 0.2, 0.3, 0.5]) {
    out(`    one trust for everyone ${String(p).padEnd(4)}: ${fmt(finishError(ratio("Pmix", p), data.efforts), 6)}`);
  }
  out(`    per-runner trust from its own sigma: ${fmt(finishError(ratio("Pmix", (e) => trustFromPlanSigma(mixedSigma(e))), data.efforts), 6)}`);

  out("\nB. Shape still wrong after the linear slowdown fix? Median section ratio (real/plan, own-pace normalized) by progress");
  out(`  progress  ${EDGES.slice(0, 10).map((x) => `${x.toFixed(1)}+`.padStart(7)).join("")}`);
  const row = (label: string, meds: Array<number | null>) =>
    out(`  ${label.slice(0, 9).padEnd(9)} ${meds.map((v) => (v === null ? "   -   " : fmt(v, 7, 2))).join("")}`);
  for (const c of data.courses) {
    row(c, binMedians(sectionPoints(data.byCourse.get(c)!, "gpxFade")));
  }
  row("pooled", binMedians(sectionPoints(data.efforts, "gpxFade")));
  for (const c of data.courses) {
    const f = interpolateBins(binMedians(sectionPoints(data.efforts.filter((e) => e.course !== c), "gpxFade")));
    for (const e of data.byCourse.get(c)!) {
      e.plans.gpxCurve = f ? reshapePlan(e.plans.gpxFade!, e.d, f) : [...e.plans.gpxFade!];
    }
  }
  const B0 = ratio("gpxFade");
  const B0c = ratio("gpxCurve");
  courseTable("  Finish error (min) with a learned non-linear progress curve instead of the linear fix (LOCO)", data.courses, data.byCourse, [
    ["server today", SERVER],
    ["B0 approved (linear fix)", B0],
    ["B0 + non-linear progress curve", B0c]
  ]);
  out(`  next-aid error, all runners: B0 ${fmt(score(B0, data.efforts).nextAid, 0)}   B0+curve ${fmt(score(B0c, data.efforts).nextAid, 0)}`);

  const RES = fadeAwareResidual(data, "gpxFade");
  const RESc = fadeAwareResidual(data, "gpxCurve");
  courseTable("C. Fade-aware correction on top of B0 (finish error, min; LOCO)", data.courses, data.byCourse, [
    ["B0 approved", B0],
    ["B0 + fade-aware correction", RES],
    ["B0 + non-linear curve + fade-aware correction", RESc]
  ]);
  const longs = effortsOf(data, longCourses(data));
  out(`\n  Long courses pooled, finish error by progress: ${PROGRESS_BUCKETS.map((b) => bucketLabel(b).padStart(8)).join("")}`);
  const methods: Array<[string, Predictor]> = [
    ["server today", SERVER],
    ["B0 approved", B0],
    ["B0 + curve", B0c],
    ["B0 + fade-aware", RES],
    ["B0 + curve + fade-aware", RESc]
  ];
  for (const [label, fn] of methods) {
    out(`    ${label.padEnd(44)}${PROGRESS_BUCKETS.map(([lo, hi]) => fmt(finishError(fn, longs, lo, hi), 8)).join("")}`);
  }
  for (const [label, fn] of methods) {
    const s = score(fn, data.efforts);
    out(`  all runners ${label.padEnd(28)} finish ${fmt(s.finish, 6)}  next aid ${fmt(s.nextAid, 5)}`);
  }

  out("\nD. 80% finish window from B0 + curve + fade-aware; quantiles fit on the OTHER long courses");
  windowTable(data, RESc, longCourses(data), longCourses(data));
}

// ---------- fresh_look3.py ----------

export function freshLook3(data: BacktestData): void {
  out("Uniform plan error, finish error (min), LOCO");
  const fixed = () => FIXED_PLAN_TRUST;
  const b0 = ratio("gpxFade");
  const l3 = biasLayer(data, "gpxFade", fixed);
  courseTable("", data.courses, data.byCourse, [
    ["B0 approved", b0],
    ["B0 + 3-term bias layer", l3.fn]
  ]);
  for (const [label, fn] of [
    ["B0", b0],
    ["B0 + 3-term layer", l3.fn]
  ] as Array<[string, Predictor]>) {
    const s = score(fn, data.efforts);
    out(`  all runners ${label.padEnd(22)} finish ${fmt(s.finish, 6)}  next aid ${fmt(s.nextAid, 5)}`);
  }
  out("  coefficients per held-out course [a, b·seen, c·lre(1-w)]:");
  for (const c of data.courses) {
    out(`    without ${c.padEnd(26)} ${l3.betas.get(c)!.map((v) => (v >= 0 ? "+" : "") + v.toFixed(3)).join("  ")}`);
  }

  ensureMixedPlan(data);
  const perRunner = (e: Effort) => trustFromPlanSigma(mixedSigma(e));
  const longs = effortsOf(data, longCourses(data));
  out(`\nMixed field (plan sigma ${MIXED_SIGMAS.join(" / ")})`);
  for (const [label, trust, layer] of [
    ["fixed trust 0.3", fixed, false],
    ["per-runner trust", perRunner, false],
    ["fixed trust 0.3 + layer", fixed, true],
    ["per-runner trust + layer", perRunner, true]
  ] as Array<[string, (e: Effort) => number, boolean]>) {
    const fn = layer ? biasLayer(data, "Pmix", trust).fn : ratio("Pmix", trust);
    const s = score(fn, data.efforts);
    out(`  ${label.padEnd(28)} finish ${fmt(s.finish, 6)}  next aid ${fmt(s.nextAid, 5)}   long courses finish ${fmt(score(fn, longs).finish, 6)}`);
  }
}

// ---------- history_size.py ----------

export function historySize(data: BacktestData): void {
  const both = data.efforts.filter((e) => e.plans.cohort);
  if (both.length === 0) {
    out("No course has prior years (10+ earlier finishers on the same layout); nothing to measure.");
    return;
  }
  const pools = both.map((e) => e.cohortPool.length);
  out(`prior pool size per runner: median ${median(pools)}  min ${Math.min(...pools)}  max ${Math.max(...pools)}`);
  const B0 = ratio("gpxFade");
  const rng = new SeededRandom(7);
  const pools2 = new Map<Effort, number[][]>();
  const pastN: Predictor = (e, k, j) => pastRunnersEta(pools2.get(e)!, e.a, k, j);
  const blend: Predictor = (e, k, j) => {
    const o = pastN(e, k, j);
    const g = B0(e, k, j)!;
    return o === null ? g : 0.5 * (o + g);
  };
  out("\nRunners whose course has prior years. Finish / next-aid error (min). Pool = past finishers available.");
  out("  past runners   B0 on GPX plan    B0 on past-runner plan   past-runners method   50/50 B0-GPX + past-runners");
  for (const N of [10, 25, 50, 100, 250, null]) {
    for (const e of both) {
      const pool = N === null || e.cohortPool.length <= N ? e.cohortPool : rng.sample(e.cohortPool, N);
      pools2.set(e, pool);
      e.plans.cohortN = cohortPlan(pool, e.plans.gpx![e.a.length - 1]!, e.a.length);
    }
    const cells = [B0, ratio("cohortN"), pastN, blend].map((fn) => {
      const s = score(fn, both);
      return `${fmt(s.finish, 6)} / ${fmt(s.nextAid, 4)}`;
    });
    out(`  ${(N === null ? "all" : String(N)).padStart(12)}   ${cells.join("     ")}`);
  }
}

export const ANALYSES = {
  headline,
  "gpx-backtest": gpxBacktest,
  "gpx-fade": gpxFade,
  night,
  "prior-sweep": priorSweep,
  "fresh-look": freshLook,
  "fresh-look-2": freshLook2,
  "fresh-look-3": freshLook3,
  "history-size": historySize
} as const satisfies Record<string, (data: BacktestData) => void>;

export type AnalysisName = keyof typeof ANALYSES;
