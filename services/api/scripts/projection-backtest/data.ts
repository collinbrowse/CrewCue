/**
 * Load split-format events plus each course's GPX, build plans with the production micro-model,
 * and turn every complete finisher into an {@link Effort} the analyses score.
 *
 * Data folder layout (git-ignored by default; see README.md):
 *   manifest.json   { "courses": [{ "key", "gpx", "events": ["file.json", …] }] }
 *   <gpx files>     the official course, used for the micro-model plan shape
 *   <event files>   split format (`src/lib/courseHistory/format.ts`), one event or an array
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RaceCourseBaselineTrack } from "@crewcue/contracts";
import { checkpointsWithProjectedDistances, parseGpxTrack, type CourseMetricPoint } from "@crewcue/map-core";
import { completeArrivalSeconds, type CourseHistoryEvent } from "../../src/lib/courseHistory/format.js";
import { importCourseHistoryFile } from "../../src/lib/courseHistory/sources/fileImport.js";
import { buildCourseMicroSegments } from "../../src/lib/pacingEstimate/microModel/courseMesh.js";
import { buildRunnerProfile } from "../../src/lib/pacingEstimate/microModel/runnerProfile.js";
import { runScenarioSims } from "../../src/lib/pacingEstimate/microModel/scenarios.js";
import { hasUsableBaselineTrack, plannedElapsedSecondsForDistance } from "../../src/lib/raceProjection.js";
import { cohortPlan, reshapePlan } from "./formulas.js";
import { SeededRandom, slope } from "./stats.js";

export type Manifest = { courses: Array<{ key: string; gpx: string; events: string[] }> };

/** The micro-model's cold-start expected curve over one course GPX (production code). */
export type CoursePlan = {
  key: string;
  lengthMeters: number;
  gainMeters: number;
  route: CourseMetricPoint[];
  baselineTrack: RaceCourseBaselineTrack;
  coldStartFinishSeconds: number;
  start: { latitude: number; longitude: number };
};

export type Effort = {
  id: number;
  course: string;
  eventId: string;
  startTime: Date;
  /** Distance (m) at each checkpoint, from the source. */
  d: number[];
  /** Actual elapsed (s) at each checkpoint. */
  a: number[];
  /** GPX plan shape: planned elapsed at each checkpoint as a share of planned finish. */
  shape: number[];
  /** Standard-normal draw for this runner's pre-race plan error. */
  z: number;
  /** Earlier years' finishers on the same course and layout (arrival arrays). */
  cohortPool: number[][];
  /** Plan arrays keyed by name: gpx, flat, cohort (when 10+ past finishers), gpxFade, … */
  plans: Record<string, number[]>;
};

export type BacktestData = {
  courses: string[];
  plansByCourse: Map<string, CoursePlan>;
  efforts: Effort[];
  byCourse: Map<string, Effort[]>;
  /** Held-out slowdown slope used for each course's gpxFade plan. */
  slowdownByCourse: Map<string, number>;
  planSigma: number;
};

export function buildCoursePlan(key: string, gpxXml: string): CoursePlan {
  const parsed = parseGpxTrack(gpxXml);
  const route: CourseMetricPoint[] = parsed.points.map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
    ...(typeof p.elevationMeters === "number" ? { elevationMeters: p.elevationMeters } : {})
  }));
  const segments = buildCourseMicroSegments(route);
  const lengthMeters = segments.reduce((s, seg) => s + seg.deltaXMeters, 0);
  const gainMeters = segments.reduce((s, seg) => s + Math.max(0, seg.deltaZMeters), 0);
  const profile = buildRunnerProfile({ history: [], courseDistanceMeters: lengthMeters });
  const sims = runScenarioSims({ segments, profile });
  const baselineTrack: RaceCourseBaselineTrack = { points: sims.expected.distanceElapsedCurve };
  const curveEnd = baselineTrack.points[baselineTrack.points.length - 1]!.distanceMetersFromStart;
  if (!hasUsableBaselineTrack(baselineTrack, curveEnd)) {
    throw new Error(`${key}: micro-model curve is not a usable baseline track`);
  }
  return {
    key,
    lengthMeters: curveEnd,
    gainMeters,
    route,
    baselineTrack,
    coldStartFinishSeconds: baselineTrack.points[baselineTrack.points.length - 1]!.referenceElapsedSeconds,
    start: { latitude: route[0]!.latitude, longitude: route[0]!.longitude }
  };
}

/** Planned moving elapsed at a GPX distance, via production `plannedElapsedSecondsForDistance`. */
export function planAt(plan: CoursePlan, distanceMeters: number): number {
  return plannedElapsedSecondsForDistance({
    distanceMetersFromStart: distanceMeters,
    plannedPaceSecondsPerKm: 0,
    baselineTrack: plan.baselineTrack,
    courseLengthMeters: plan.lengthMeters
  });
}

/**
 * Where each checkpoint sits on the GPX. With lat/lon on every checkpoint they are projected in
 * order (production `checkpointsWithProjectedDistances`); otherwise by share of the source distance.
 */
export function checkpointGpxDistances(event: CourseHistoryEvent, plan: CoursePlan): number[] {
  const cps = event.checkpoints;
  const finish = cps[cps.length - 1]!.distanceMeters;
  if (cps.every((cp) => cp.latitude !== undefined && cp.longitude !== undefined)) {
    const projected = checkpointsWithProjectedDistances(
      cps.map((cp) => ({ id: cp.id, latitude: cp.latitude!, longitude: cp.longitude! })),
      plan.route
    ).map((cp) => cp.distanceMetersFromStart ?? 0);
    projected[0] = 0;
    projected[projected.length - 1] = plan.lengthMeters;
    if (projected.every((x, i) => i === 0 || x > projected[i - 1]!)) {
      return projected;
    }
  }
  return cps.map((cp) => (cp.distanceMeters / finish) * plan.lengthMeters);
}

function layoutSignature(event: CourseHistoryEvent): string {
  return event.checkpoints.map((cp) => Math.round(cp.distanceMeters)).join(",");
}

/** Per held-out course: least-squares slope of (actual/plan section ratio, own-pace normalized) on progress. */
export function fitSlowdownLoco(byCourse: Map<string, Effort[]>, planKey = "gpx"): Map<string, number> {
  const points = new Map<string, { xs: number[]; ys: number[] }>();
  for (const [course, efforts] of byCourse) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const e of efforts) {
      const g = e.plans[planKey]!;
      const scale = e.a[e.a.length - 1]! / g[g.length - 1]!;
      for (let i = 1; i < e.a.length; i += 1) {
        xs.push((e.d[i - 1]! + e.d[i]!) / 2 / e.d[e.d.length - 1]!);
        ys.push((e.a[i]! - e.a[i - 1]!) / (g[i]! - g[i - 1]!) / scale);
      }
    }
    points.set(course, { xs, ys });
  }
  const fits = new Map<string, number>();
  for (const course of byCourse.keys()) {
    const others = [...points].filter(([c]) => c !== course).map(([, p]) => p);
    const xs = others.flatMap((p) => p.xs);
    const ys = others.flatMap((p) => p.ys);
    const fitted = xs.length > 1 ? slope(xs, ys) : Number.NaN;
    fits.set(course, Number.isFinite(fitted) ? fitted : 0.24);
  }
  return fits;
}

export function loadBacktestData(
  dataDir: string,
  options: { planSigma?: number; seed?: number; slowdown?: "loco" | number } = {}
): BacktestData {
  const planSigma = options.planSigma ?? 0.12;
  const rng = new SeededRandom(options.seed ?? 20261103);
  const manifest = JSON.parse(readFileSync(resolve(dataDir, "manifest.json"), "utf8")) as Manifest;
  const plansByCourse = new Map<string, CoursePlan>();
  const efforts: Effort[] = [];
  const byCourse = new Map<string, Effort[]>();

  for (const course of manifest.courses) {
    const plan = buildCoursePlan(course.key, readFileSync(resolve(dataDir, course.gpx), "utf8"));
    plansByCourse.set(course.key, plan);
    const events = course.events.flatMap((file) => importCourseHistoryFile(resolve(dataDir, file)));
    // One layout per course: the checkpoint signature with the most finishers.
    const bySignature = new Map<string, CourseHistoryEvent[]>();
    for (const event of events) {
      const sig = layoutSignature(event);
      bySignature.set(sig, [...(bySignature.get(sig) ?? []), event]);
    }
    const [, layoutEvents] = [...bySignature].sort(
      (x, y) => y[1].reduce((s, e) => s + e.efforts.length, 0) - x[1].reduce((s, e) => s + e.efforts.length, 0)
    )[0]!;
    layoutEvents.sort((x, y) => Date.parse(x.startTime) - Date.parse(y.startTime));

    const first = layoutEvents[0]!;
    const gpxDistances = checkpointGpxDistances(first, plan);
    const total = planAt(plan, plan.lengthMeters);
    const shape = gpxDistances.map((x) => planAt(plan, x) / total);
    const d = first.checkpoints.map((cp) => cp.distanceMeters);

    const courseEfforts: Effort[] = [];
    let prior: number[][] = [];
    for (const event of layoutEvents) {
      const series = event.efforts
        .map((effort) => completeArrivalSeconds(event, effort))
        .filter((a): a is number[] => a !== null && a.every((t, i) => i === 0 || t > a[i - 1]!));
      for (const a of series) {
        const z = rng.gauss();
        const planned = a[a.length - 1]! * Math.exp(planSigma * z);
        const e: Effort = {
          id: efforts.length,
          course: course.key,
          eventId: event.sourceEventId,
          startTime: new Date(event.startTime),
          d,
          a,
          shape,
          z,
          cohortPool: prior,
          plans: {
            gpx: shape.map((f) => f * planned),
            flat: d.map((x) => (x / d[d.length - 1]!) * planned)
          }
        };
        if (prior.length >= 10) {
          e.plans.cohort = cohortPlan(prior, planned, a.length);
        }
        efforts.push(e);
        courseEfforts.push(e);
      }
      prior = [...prior, ...series];
    }
    byCourse.set(course.key, courseEfforts);
  }

  const slowdownByCourse =
    options.slowdown === undefined || options.slowdown === "loco"
      ? fitSlowdownLoco(byCourse)
      : new Map([...byCourse.keys()].map((c) => [c, options.slowdown as number]));
  for (const e of efforts) {
    const s = slowdownByCourse.get(e.course)!;
    e.plans.gpxFade = reshapePlan(e.plans.gpx!, e.d, (x) => 1 + s * (x - 0.5));
  }

  return {
    courses: [...byCourse.keys()].sort(),
    plansByCourse,
    efforts,
    byCourse,
    slowdownByCourse,
    planSigma
  };
}

/** Same plan shape (`src` key), level redrawn as actual finish × exp(σ·z) — the runner's own z. */
export function rescaleLevel(efforts: Effort[], sigma: number | ((e: Effort) => number), src: string, dst: string): void {
  for (const e of efforts) {
    const s = typeof sigma === "number" ? sigma : sigma(e);
    const P = e.plans[src]!;
    const k = (e.a[e.a.length - 1]! * Math.exp(s * e.z)) / P[P.length - 1]!;
    e.plans[dst] = P.map((x) => x * k);
  }
}
