/**
 * Checks the backtest's "server today" baseline (`formulas.anchoredEta`) against the production
 * finish ETA: each runner is replayed as pings at its checkpoint crossings through
 * `recomputeRaceProjection`, with the runner's plan as the room's baseline track.
 *
 * PR 3 replaces the live formula in production; this is where it gets compared to the real code path.
 */
import type { RaceCourse, RaceCourseCheckpoint } from "@crewcue/contracts";
import { checkpointsWithProjectedDistances, geodesicCumulativeAtVertices, type CourseMetricPoint } from "@crewcue/map-core";
import { recomputeRaceProjection, type ProjectionPreviousState } from "../../src/lib/raceProjection.js";
import { planAt, type BacktestData, type Effort } from "./data.js";
import { anchoredEta } from "./formulas.js";

function pointAtDistance(route: CourseMetricPoint[], cum: number[], meters: number): CourseMetricPoint {
  const target = Math.max(0, Math.min(cum[cum.length - 1]!, meters));
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < target) {
    i += 1;
  }
  const t = cum[i]! > cum[i - 1]! ? (target - cum[i - 1]!) / (cum[i]! - cum[i - 1]!) : 0;
  const p0 = route[i - 1]!;
  const p1 = route[i]!;
  return { latitude: p0.latitude + t * (p1.latitude - p0.latitude), longitude: p0.longitude + t * (p1.longitude - p0.longitude) };
}

export type ParityResult = { compared: number; maxDiffSeconds: number; failures: string[] };

export function checkServerParity(data: BacktestData, perCourse = 5): ParityResult {
  const failures: string[] = [];
  let compared = 0;
  let maxDiffSeconds = 0;
  for (const course of data.courses) {
    const plan = data.plansByCourse.get(course)!;
    const cum = geodesicCumulativeAtVertices(plan.route);
    const routeLength = cum[cum.length - 1]!;
    for (const e of (data.byCourse.get(course) ?? []).slice(0, perCourse)) {
      const n = e.a.length - 1;
      // Checkpoints placed on the route at their share of the course, then measured by production code.
      const raw: RaceCourseCheckpoint[] = e.d.map((x, i) => ({
        id: `cp-${i}`,
        ...pointAtDistance(plan.route, cum, (x / e.d[n]!) * routeLength)
      }));
      const checkpoints = checkpointsWithProjectedDistances(raw, plan.route);
      const scale = e.plans.gpx![n]! / planAt(plan, plan.lengthMeters);
      const raceCourse: RaceCourse = {
        checkpoints,
        baselineTrack: {
          points: plan.baselineTrack.points.map((p) => ({
            distanceMetersFromStart: p.distanceMetersFromStart,
            referenceElapsedSeconds: p.referenceElapsedSeconds * scale
          }))
        }
      };
      const P = checkpoints.map((cp) => planAt(plan, cp.distanceMetersFromStart!) * scale);
      P[n] = planAt(plan, plan.lengthMeters) * scale;
      const startMs = e.startTime.getTime();
      const iso = (s: number) => new Date(startMs + s * 1000).toISOString();
      let previous: ProjectionPreviousState | null = null;
      let previousPing: { pingId: string; latitude: number; longitude: number; recordedAt: string } | null = null;
      for (let k = 0; k < n; k += 1) {
        // A ping just past checkpoint k, so the crossing registers.
        const at = Math.min(routeLength, checkpoints[k]!.distanceMetersFromStart! + 2);
        const ping = { pingId: `${e.id}-${k}`, ...pointAtDistance(plan.route, cum, at), recordedAt: iso(e.a[k]!) };
        const result = recomputeRaceProjection({
          roomId: `parity-${e.id}`,
          activatedAt: iso(0),
          course: raceCourse,
          plannedPaceSecondsPerKm: 480,
          ping,
          previousPing,
          previous,
          routeMetricPoints: plan.route,
          canonicalCourseLengthMeters: plan.lengthMeters
        });
        previous = result.state;
        previousPing = ping;
        if (k === 0) {
          continue;
        }
        const production = (Date.parse(result.projection.etaFinishPlanIso) - startMs) / 1000;
        const formula = Math.max(e.a[k]!, anchoredEta(e as Effort, P, k, n));
        const diff = Math.abs(production - formula);
        compared += 1;
        maxDiffSeconds = Math.max(maxDiffSeconds, diff);
        if (diff > 1) {
          failures.push(`${course} effort ${e.id} at checkpoint ${k}: production ${production.toFixed(0)} s vs formula ${formula.toFixed(0)} s`);
        }
      }
    }
  }
  return { compared, maxDiffSeconds, failures };
}
