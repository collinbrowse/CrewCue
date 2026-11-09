/**
 * A runner's own late-race slowdown, measured from finished efforts and combined into the
 * profile's `slowdownSlope` (plan PR 6).
 *
 * Measurement is the backtest's fit: for each section, y = (actual ÷ planned moving time) divided
 * by the effort's overall actual ÷ planned, and x = the section's midpoint as a share of the
 * course. The slope of y on x is the slowdown. The plan is the micro-model's cold-start shape over
 * the same route WITHOUT any slowdown, so the measured slope is the whole slowdown, not a residual.
 *
 * Combining is shrinkage toward the population default: one race moves the number about a third
 * of the way, three races about 60%.
 */
import { geodesicCumulativeAtVertices, type CourseMetricPoint, type GpxTrackPoint } from "@crewcue/map-core";
import { buildCourseMicroSegments } from "./pacingEstimate/microModel/courseMesh.js";
import { buildRunnerProfile } from "./pacingEstimate/microModel/runnerProfile.js";
import { runScenarioSims } from "./pacingEstimate/microModel/scenarios.js";
import { interpolateElapsedAtDistance } from "./pacingEstimate/microModel/simulate.js";
import { SLOWDOWN_MIN_EFFORT_METERS } from "./slowdownShrinkage.js";

export {
  personalSlowdownSlope,
  SLOWDOWN_FULL_WEIGHT_METERS,
  SLOWDOWN_MIN_EFFORT_METERS,
  SLOWDOWN_SHRINK_K,
  SLOWDOWN_SLOPE_RANGE,
  type SlowdownObservation
} from "./slowdownShrinkage.js";

/** The timed sections must cover at least this share of the course. */
export const SLOWDOWN_MIN_COVERAGE = 0.8;
export const SLOWDOWN_MIN_SECTIONS = 3;
export type TimedSection = {
  startMeters: number;
  endMeters: number;
  /** Moving seconds (stops at checkpoints taken out). */
  actualSeconds: number;
  plannedSeconds: number;
};

/** Slope of section pace vs progress, or null when the effort is too short or too sparse. */
export function measureSlowdownSlope(sections: readonly TimedSection[], courseLengthMeters: number): number | null {
  const usable = sections.filter(
    (s) => s.endMeters > s.startMeters && s.actualSeconds > 0 && s.plannedSeconds > 0 && Number.isFinite(s.actualSeconds)
  );
  const covered = usable.reduce((sum, s) => sum + (s.endMeters - s.startMeters), 0);
  if (
    courseLengthMeters < SLOWDOWN_MIN_EFFORT_METERS ||
    usable.length < SLOWDOWN_MIN_SECTIONS ||
    covered < SLOWDOWN_MIN_COVERAGE * courseLengthMeters
  ) {
    return null;
  }
  const overall =
    usable.reduce((sum, s) => sum + s.actualSeconds, 0) / usable.reduce((sum, s) => sum + s.plannedSeconds, 0);
  const xs = usable.map((s) => (s.startMeters + s.endMeters) / 2 / courseLengthMeters);
  const ys = usable.map((s) => s.actualSeconds / s.plannedSeconds / overall);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i]! - my);
    den += (x - mx) ** 2;
  });
  return den > 0 ? num / den : null;
}

/** The micro-model's cold-start moving-time curve over a route, with no slowdown applied. */
export function unfadedPlanCurve(route: readonly CourseMetricPoint[]): {
  lengthMeters: number;
  plannedAt: (meters: number) => number;
} {
  const segments = buildCourseMicroSegments([...route]);
  const lengthMeters = segments.reduce((sum, s) => sum + s.deltaXMeters, 0);
  const profile = { ...buildRunnerProfile({ history: [], courseDistanceMeters: lengthMeters }), slowdownSlope: 0 };
  const curve = runScenarioSims({ segments, profile, courseLengthMeters: lengthMeters }).expected.distanceElapsedCurve;
  return { lengthMeters, plannedAt: (meters) => interpolateElapsedAtDistance(curve, meters) };
}

/**
 * Slowdown from an uploaded activity's own timed track: cut into ~5 km sections, compare each
 * section's time with the unfaded cold-start model over the same ground. Null when the activity
 * is under 30 km, untimed, or has gaps covering more than 20% of it.
 */
export function slowdownFromTimedTrack(track: readonly GpxTrackPoint[]): number | null {
  const cumulative = geodesicCumulativeAtVertices(track.map((p) => ({ latitude: p.latitude, longitude: p.longitude })));
  const points = track.map((p, i) => ({ ...p, cumulativeMeters: cumulative[i]! }));
  const timed = points.filter((p) => p.timestampMs !== null);
  if (timed.length < 10) {
    return null;
  }
  const route = points.map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
    ...(p.elevationMeters !== null ? { elevationMeters: p.elevationMeters } : {})
  }));
  const plan = unfadedPlanCurve(route);
  const total = points[points.length - 1]!.cumulativeMeters;
  const step = 5000;
  const sections: TimedSection[] = [];
  let from = timed[0]!;
  for (const p of timed) {
    if (p.cumulativeMeters - from.cumulativeMeters < step && p !== timed[timed.length - 1]) {
      continue;
    }
    const actualSeconds = (p.timestampMs! - from.timestampMs!) / 1000;
    // Over 6× the cold-start plan (10:00/mi effort) is a long stop or a recording gap, not
    // moving time: leave the section out (it then counts against coverage).
    const plannedSeconds = plan.plannedAt(p.cumulativeMeters) - plan.plannedAt(from.cumulativeMeters);
    if (actualSeconds > 0 && plannedSeconds > 0 && actualSeconds < 6 * plannedSeconds) {
      sections.push({ startMeters: from.cumulativeMeters, endMeters: p.cumulativeMeters, actualSeconds, plannedSeconds });
    }
    from = p;
  }
  return measureSlowdownSlope(sections, total);
}
