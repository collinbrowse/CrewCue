/**
 * Own-runs test: does a runner's personal climbing and descent, learned from their other runs,
 * place time across a held-out run better than the shared grade-cost curve?
 *
 * Leave one run out. For the held-out run, every model's step times are scaled to its actual
 * moving time, so effort (easy day vs race) cancels and only *where the time goes* is scored:
 * per-kilometer |predicted − actual| as a share of moving time.
 *
 * Models:
 *   shared       step time ∝ shared cost(grade)
 *   six-value    shared × a factor per class: flat, runnable climb, hiking-grade climb (from the
 *                runner's switch grade), runnable descent, steep descent
 *   per-grade    shared × a factor per 1% grade
 * Factors are pooled across the other runs relative to each run's own level, shrunk toward 1.
 *
 * Usage (services/api): npm run own-runs:backtest -- <folder of .fit/.gpx/.tcx> [--equal]
 * --equal: each run's class factors count equally (median across runs) instead of pooled seconds.
 * Keep the folder git-ignored (e.g. projection-backtest-data/my-runs): tracks show where people run.
 * Slice 2 of docs/product/run-import-and-grade-curve-scope.md.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildActivityGradeSteps,
  parseActivityFile,
  type ActivityGradeStep,
  type ActivitySport
} from "@crewcue/map-core";
import { gradeCostMultiplier } from "../src/lib/pacingEstimate/microModel/simulate.js";

const SHRINK_METERS = 500;
const EQUAL_RUN_WEIGHT = process.argv.includes("--equal");
const CHUNK_METERS = 1000;
const STEP = 5;
const shared = (g: number) => gradeCostMultiplier(g, 1, 1);

type Run = { name: string; date: string; km: number; gain: number; steps: ActivityGradeStep[]; level: number };

/** Runs, trail runs and hikes only (no rides or walks), at least MIN_KM, within the window. */
const FOOT: ReadonlyArray<ActivitySport | null> = ["running", "trail_running", "hiking", null];
const MIN_KM = 3;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(fit|gpx|tcx)$/i.test(name) ? [path] : [];
  });
}

function loadRuns(dir: string, sinceMs: number): { runs: Run[]; skipped: Record<string, number> } {
  const runs: Run[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  for (const path of filesUnder(dir).sort()) {
    let parsed;
    try {
      parsed = parseActivityFile(new Uint8Array(readFileSync(path)), path);
    } catch {
      skip("unreadable or no distance");
      continue;
    }
    if (!FOOT.includes(parsed.sport)) {
      skip(`sport ${parsed.sport}`);
      continue;
    }
    if (parsed.startTimestampMs === null || parsed.startTimestampMs < sinceMs) {
      skip("older than the window");
      continue;
    }
    if (parsed.distanceMeters < MIN_KM * 1000) {
      skip(`under ${MIN_KM} km`);
      continue;
    }
    const built = buildActivityGradeSteps(parsed.points);
    if (!built) {
      skip("no usable track");
      continue;
    }
    const seconds = built.steps.reduce((s, x) => s + x.seconds, 0);
    const cost = built.steps.reduce((s, x) => s + STEP * shared(x.grade), 0);
    runs.push({
      name: path.split("/").pop()!.replace(/\.(fit|gpx|tcx)$/i, "").slice(0, 18),
      date: new Date(parsed.startTimestampMs).toISOString().slice(0, 10),
      km: parsed.distanceMeters / 1000,
      gain: parsed.elevationGainMeters ?? 0,
      steps: built.steps,
      level: seconds / cost
    });
  }
  return { runs, skipped };
}

const CLASS_NAMES = ["flat", "runnable climb", "hiking-grade climb", "runnable descent", "steep descent"] as const;
function classOf(g: number, switchGrade: number): number {
  if (g >= switchGrade) return 2;
  if (g >= 0.04) return 1;
  if (g <= -0.15) return 4;
  if (g <= -0.04) return 3;
  return 0;
}

type Personal = { switchGrade: number; classFactor: number[]; gradeFactor: Map<number, number> };

/** Learn the personal values from runs (each relative to its own level), shrunk toward the shared curve. */
function learn(runs: readonly Run[]): Personal {
  // Switch grade: lowest climb grade (≥4%) where at least half the distance is hiked.
  const hike = new Map<number, { hiked: number; total: number }>();
  for (const r of runs) {
    for (const s of r.steps) {
      const pct = Math.round(s.grade * 100);
      if (pct < 4) continue;
      const row = hike.get(pct) ?? { hiked: 0, total: 0 };
      row.total += STEP;
      if (s.hiking) row.hiked += STEP;
      hike.set(pct, row);
    }
  }
  let switchGrade = 0.12;
  for (const pct of [...hike.keys()].sort((a, b) => a - b)) {
    const row = hike.get(pct)!;
    if (row.total >= 200 && row.hiked / row.total >= 0.5) {
      switchGrade = pct / 100;
      break;
    }
  }
  const classSec = new Array<number>(5).fill(0);
  const classExp = new Array<number>(5).fill(0);
  const classM = new Array<number>(5).fill(0);
  const gradeAcc = new Map<number, { sec: number; exp: number; m: number }>();
  for (const r of runs) {
    for (const s of r.steps) {
      const expected = r.level * STEP * shared(s.grade);
      const c = classOf(s.grade, switchGrade);
      classSec[c]! += s.seconds;
      classExp[c]! += expected;
      classM[c]! += STEP;
      const pct = Math.max(-40, Math.min(40, Math.round(s.grade * 100)));
      const row = gradeAcc.get(pct) ?? { sec: 0, exp: 0, m: 0 };
      row.sec += s.seconds;
      row.exp += expected;
      row.m += STEP;
      gradeAcc.set(pct, row);
    }
  }
  const shrink = (ratio: number, meters: number) => (meters * ratio + SHRINK_METERS) / (meters + SHRINK_METERS);
  const classFactor = EQUAL_RUN_WEIGHT
    ? CLASS_NAMES.map((_, c) => {
        // Each run's own class ratio (vs its own level), then the median across runs.
        const ratios: number[] = [];
        for (const r of runs) {
          let sec = 0;
          let exp = 0;
          let m = 0;
          for (const st of r.steps) {
            if (classOf(st.grade, switchGrade) !== c) continue;
            sec += st.seconds;
            exp += r.level * STEP * shared(st.grade);
            m += STEP;
          }
          if (m >= 300) ratios.push(sec / exp);
        }
        if (ratios.length === 0) return 1;
        ratios.sort((a, b) => a - b);
        return shrink(ratios[ratios.length >> 1]!, ratios.length * 1000);
      })
    : classSec.map((sec, c) => (classExp[c]! > 0 ? shrink(sec / classExp[c]!, classM[c]!) : 1));
  const gradeFactor = new Map<number, number>();
  for (const [pct, row] of gradeAcc) gradeFactor.set(pct, shrink(row.sec / row.exp, row.m));
  return { switchGrade, classFactor, gradeFactor };
}

type Model = (s: ActivityGradeStep) => number;

/** Share of the held-out run's moving time placed in the wrong kilometer (½ Σ|pred − act| / total). */
function misplaced(run: Run, model: Model): number {
  const raw = run.steps.map((s) => model(s));
  const total = run.steps.reduce((s, x) => s + x.seconds, 0);
  const rawTotal = raw.reduce((s, x) => s + x, 0);
  const chunks = new Map<number, { pred: number; act: number }>();
  run.steps.forEach((s, i) => {
    const k = Math.floor(s.atMeters / CHUNK_METERS);
    const row = chunks.get(k) ?? { pred: 0, act: 0 };
    row.pred += (raw[i]! / rawTotal) * total;
    row.act += s.seconds;
    chunks.set(k, row);
  });
  let err = 0;
  for (const row of chunks.values()) err += Math.abs(row.pred - row.act);
  return err / 2 / total;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const dir = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!dir) {
  console.error("usage: npm run own-runs:backtest -- <folder of .fit/.gpx/.tcx> [--equal] [--days 365]");
  process.exit(1);
}
const daysArg = process.argv.indexOf("--days");
const days = daysArg > 0 ? Number(process.argv[daysArg + 1]) : 365;
const loaded = loadRuns(dir, Date.now() - days * 86_400_000);
const runs = loaded.runs;
console.log("Skipped:", JSON.stringify(loaded.skipped));
console.log(`${runs.length} runs with a usable track.\n`);
console.log("Held-out run                 date        km    gain   moving time misplaced by km");
console.log("                                                       shared   six-value   per-grade");
const sums = [0, 0, 0];
for (const held of runs) {
  const p = learn(runs.filter((r) => r !== held));
  const models: Model[] = [
    (s) => shared(s.grade),
    (s) => shared(s.grade) * p.classFactor[classOf(s.grade, p.switchGrade)]!,
    (s) => shared(s.grade) * (p.gradeFactor.get(Math.max(-40, Math.min(40, Math.round(s.grade * 100)))) ?? 1)
  ];
  const scores = models.map((m) => misplaced(held, m));
  scores.forEach((v, i) => (sums[i]! += v));
  console.log(
    `${held.name.padEnd(28)} ${held.date}  ${held.km.toFixed(1).padStart(5)}  ${String(Math.round(held.gain)).padStart(5)}   ${scores
      .map((v) => pct(v).padStart(7))
      .join("     ")}`
  );
}
console.log(`${"mean".padEnd(28)} ${"".padEnd(10)}  ${"".padStart(5)}  ${"".padStart(5)}   ${sums.map((v) => pct(v / runs.length).padStart(7)).join("     ")}`);

const all = learn(runs);
console.log(`\nYour values from all ${runs.length} runs (factor > 1 = slower than the shared curve predicts, relative to your own level):`);
console.log(`  switch grade (half your distance hiked): ${(all.switchGrade * 100).toFixed(0)}%`);
CLASS_NAMES.forEach((name, c) => console.log(`  ${name.padEnd(20)} ${all.classFactor[c]!.toFixed(2)}`));
