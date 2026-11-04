/**
 * Segment-by-segment moving-time simulation (physiology micro-model).
 */
import {
  ALTITUDE_PENALTY_PER_300M,
  ALTITUDE_PENALTY_START_METERS,
  GRADE_COST_MIN_MULTIPLIER,
  MINETTI_DOWNHILL_LINEAR,
  MINETTI_DOWNHILL_QUADRATIC,
  MINETTI_UPHILL_LINEAR,
  MINETTI_UPHILL_QUADRATIC,
  TECHNICAL_DOWNHILL_EXTRA,
  TECHNICAL_DOWNHILL_GRADE
} from "./constants.js";
import { NIGHT_PACE_FACTOR, NIGHT_SUN_ELEVATION_DEGREES } from "../../projectionTuning.js";
import type { CourseMicroSegment } from "./courseMesh.js";
import type { RunnerProfile } from "./runnerProfile.js";
import { sunElevationDegrees } from "./sun.js";

/**
 * Clock-time context for the night factor. A segment that starts while the sun is below −6° at
 * this location (race start + simulated elapsed) costs NIGHT_PACE_FACTOR more moving time.
 */
export type NightContext = {
  raceStartMs: number;
  latitude: number;
  longitude: number;
};

export type ScenarioKnobs = {
  gapMultiplier: number;
  gamma1Multiplier: number;
  gamma2Multiplier: number;
  altitudePenaltyMultiplier: number;
};

export type SimulationState = {
  /** Cumulative mechanical/relative work proxy. */
  workCum: number;
  /** Cumulative downhill impact (m). */
  descentCum: number;
  /** Elapsed moving seconds from course start (or from resume point). */
  elapsedSeconds: number;
};

export type SegmentPaceResult = {
  segmentIndex: number;
  startMeters: number;
  endMeters: number;
  durationSeconds: number;
  paceSecondsPerMeter: number;
  elapsedAtEndSeconds: number;
};

export type SimulationResult = {
  state: SimulationState;
  segments: SegmentPaceResult[];
  /** Distance (m) → elapsed (s) samples at each segment end (+ start 0). */
  distanceElapsedCurve: Array<{ distanceMetersFromStart: number; referenceElapsedSeconds: number }>;
};

/**
 * Physiological relative running cost vs flat (g = rise/run), restored in C4 (#483).
 * Asymmetric uphill/downhill quadratics: uphill rises steeply; shallow downhill is cheaper than
 * flat before eccentric braking dominates. C1's flat-equivalent GAP means this full curve applies
 * without double-counting the terrain already in history pace.
 */
export function minettiRelativeCost(grade: number): number {
  const g = Math.max(-0.45, Math.min(0.45, grade));
  const relative =
    g >= 0
      ? 1 + MINETTI_UPHILL_LINEAR * g + MINETTI_UPHILL_QUADRATIC * g * g
      : 1 + MINETTI_DOWNHILL_LINEAR * g + MINETTI_DOWNHILL_QUADRATIC * g * g;
  return Math.max(GRADE_COST_MIN_MULTIPLIER, relative);
}

export function altitudeFactor(altitudeMeters: number, penaltyMultiplier = 1): number {
  if (!(altitudeMeters > ALTITUDE_PENALTY_START_METERS)) {
    return 1;
  }
  const raw =
    1 - ALTITUDE_PENALTY_PER_300M * ((altitudeMeters - ALTITUDE_PENALTY_START_METERS) / 300);
  const deficit = 1 - Math.max(0.7, raw);
  return 1 - deficit * penaltyMultiplier;
}

/**
 * Effective grade cost after terrain efficiency, downhill penalty, and profile blend.
 * blend=1 → full model; blend=0 → always 1 (ignore grade).
 */
export function gradeCostMultiplier(
  grade: number,
  terrainEfficiency: number,
  gradeCostBlend = 1
): number {
  let m = minettiRelativeCost(grade) * terrainEfficiency;
  if (grade < TECHNICAL_DOWNHILL_GRADE) {
    m *= TECHNICAL_DOWNHILL_EXTRA;
  }
  const blend = Math.max(0, Math.min(1, gradeCostBlend));
  const blended = 1 + (m - 1) * blend;
  return Math.max(GRADE_COST_MIN_MULTIPLIER, blended);
}

/**
 * Per-segment terrain-adjusted base duration (endurance-scaled, no fatigue) and the fatigue SHAPE
 * multiplier at the segment's cumulative state. C3 keeps these separate so fatigue can be
 * renormalized to redistribute the total rather than inflate it.
 */
function segmentComponents(input: {
  segment: CourseMicroSegment;
  profile: RunnerProfile;
  knobs: ScenarioKnobs;
  state: SimulationState;
}): { baseDuration: number; fatigue: number; workAdd: number; descentAdd: number } {
  const { segment, profile, knobs, state } = input;
  const mGrade = gradeCostMultiplier(segment.grade, profile.terrainEfficiency, profile.gradeCostBlend);
  const fAltRaw = altitudeFactor(segment.altitudeMeters, knobs.altitudePenaltyMultiplier);
  const fAlt = 1 + (fAltRaw - 1) * profile.gradeCostBlend;
  const c = Math.max(1, segment.surfaceComplexity);
  // C2: endurance scales the baseline pace toward the course distance.
  const gapSpm = profile.gapSecondsPerMeter * profile.enduranceFactor * knobs.gapMultiplier;
  const baseDuration = gapSpm * mGrade * c * Math.max(GRADE_COST_MIN_MULTIPLIER, fAlt) * segment.deltaXMeters;
  const gamma1 = profile.gamma1 * knobs.gamma1Multiplier;
  const gamma2 = profile.gamma2 * knobs.gamma2Multiplier;
  const fatigue = Math.max(1, 1 + gamma1 * state.workCum + gamma2 * state.descentCum);
  const workAdd = mGrade * segment.deltaXMeters;
  const descentAdd = Math.max(0, -segment.grade) * segment.deltaXMeters;
  return { baseDuration, fatigue, workAdd, descentAdd };
}

/**
 * Simulate moving time over segments. Optional `fromDistanceMeters` skips completed course.
 * Initial state may carry fatigue from the covered portion.
 */
export function simulateMovingTime(input: {
  segments: CourseMicroSegment[];
  profile: RunnerProfile;
  knobs: ScenarioKnobs;
  fromDistanceMeters?: number;
  initialState?: SimulationState;
  /** Whole-course length for the slowdown's progress fraction; defaults to the last segment's end. */
  courseLengthMeters?: number;
  /** When set, segments run in the dark cost NIGHT_PACE_FACTOR more (adds time; not renormalized). */
  night?: NightContext;
}): SimulationResult {
  const fromDistance = Math.max(0, input.fromDistanceMeters ?? 0);
  const state: SimulationState = input.initialState
    ? { ...input.initialState }
    : { workCum: 0, descentCum: 0, elapsedSeconds: 0 };

  // If resuming mid-course without initial fatigue, warm up work/descent over skipped segments.
  if (fromDistance > 0 && !input.initialState) {
    for (const segment of input.segments) {
      const endMeters = segment.startMeters + segment.deltaXMeters;
      if (endMeters <= fromDistance + 1e-6) {
        const partial = segmentComponents({
          segment,
          profile: input.profile,
          knobs: input.knobs,
          state
        });
        state.workCum += partial.workAdd;
        state.descentCum += partial.descentAdd;
        state.elapsedSeconds += partial.baseDuration * partial.fatigue;
      } else if (segment.startMeters < fromDistance) {
        const frac = (fromDistance - segment.startMeters) / segment.deltaXMeters;
        const clipped: CourseMicroSegment = {
          ...segment,
          deltaXMeters: fromDistance - segment.startMeters,
          deltaZMeters: segment.deltaZMeters * frac
        };
        const partial = segmentComponents({
          segment: clipped,
          profile: input.profile,
          knobs: input.knobs,
          state
        });
        state.workCum += partial.workAdd;
        state.descentCum += partial.descentAdd;
        state.elapsedSeconds += partial.baseDuration * partial.fatigue;
      }
    }
    // Elapsed at resume is "actual" only when caller sets initialState; for warm-up we keep model elapsed.
  }

  // Pass 1: per-segment endurance-scaled terrain base duration + fatigue shape, accumulating the raw
  // fatigue state (work/descent). Fatigue is not applied to state yet, so accumulation stays exact.
  type EmittedSegment = {
    index: number;
    startMeters: number;
    endMeters: number;
    deltaXMeters: number;
    baseDuration: number;
    fatigue: number;
  };
  const emitted: EmittedSegment[] = [];
  let baseTotal = 0;
  let fatiguedTotal = 0;
  for (const segment of input.segments) {
    const endMeters = segment.startMeters + segment.deltaXMeters;
    if (endMeters <= fromDistance + 1e-6) {
      continue;
    }
    let seg = segment;
    if (segment.startMeters < fromDistance) {
      const remain = endMeters - fromDistance;
      const frac = remain / segment.deltaXMeters;
      seg = {
        ...segment,
        startMeters: fromDistance,
        deltaXMeters: remain,
        deltaZMeters: segment.deltaZMeters * frac
      };
    }

    const { baseDuration, fatigue, workAdd, descentAdd } = segmentComponents({
      segment: seg,
      profile: input.profile,
      knobs: input.knobs,
      state
    });
    state.workCum += workAdd;
    state.descentCum += descentAdd;
    baseTotal += baseDuration;
    fatiguedTotal += baseDuration * fatigue;
    emitted.push({
      index: seg.index,
      startMeters: seg.startMeters,
      endMeters: seg.startMeters + seg.deltaXMeters,
      deltaXMeters: seg.deltaXMeters,
      baseDuration,
      fatigue
    });
  }

  // C3 (#483): renormalize fatigue so it only redistributes the endurance-scaled terrain total
  // (baseTotal) across the course — later segments slower, earlier faster — without inflating the
  // finish. Endurance (C2) owns the total; γ owns the shape.
  const fatigueNorm = fatiguedTotal > 0 ? baseTotal / fatiguedTotal : 1;

  // Late-race slowdown (profile.slowdownSlope; 0 = off): stretch later segments and shrink earlier
  // ones by (1 + s·(progress − 0.5)), renormalized so this pass keeps the same total.
  const slope = input.profile.slowdownSlope ?? 0;
  const lastSegment = input.segments[input.segments.length - 1];
  const courseEnd =
    input.courseLengthMeters ?? (lastSegment ? lastSegment.startMeters + lastSegment.deltaXMeters : 0);
  const shape = emitted.map((seg) =>
    slope !== 0 && courseEnd > 0
      ? Math.max(0.1, 1 + slope * ((seg.startMeters + seg.endMeters) / 2 / courseEnd - 0.5))
      : 1
  );
  let unshapedTotal = 0;
  let shapedTotal = 0;
  emitted.forEach((seg, i) => {
    const d = seg.baseDuration * seg.fatigue * fatigueNorm;
    unshapedTotal += d;
    shapedTotal += d * shape[i]!;
  });
  const slowdownNorm = shapedTotal > 0 ? unshapedTotal / shapedTotal : 1;

  const results: SegmentPaceResult[] = [];
  const curve: SimulationResult["distanceElapsedCurve"] = [
    {
      distanceMetersFromStart: fromDistance,
      referenceElapsedSeconds: state.elapsedSeconds
    }
  ];
  // Pass 2: apply renormalized fatigue to build per-segment results and the distance/elapsed curve.
  for (const [i, seg] of emitted.entries()) {
    let duration = seg.baseDuration * seg.fatigue * fatigueNorm * shape[i]! * slowdownNorm;
    if (input.night) {
      const clockMs = input.night.raceStartMs + state.elapsedSeconds * 1000;
      if (sunElevationDegrees(clockMs, input.night.latitude, input.night.longitude) < NIGHT_SUN_ELEVATION_DEGREES) {
        duration *= NIGHT_PACE_FACTOR;
      }
    }
    state.elapsedSeconds += duration;
    results.push({
      segmentIndex: seg.index,
      startMeters: seg.startMeters,
      endMeters: seg.endMeters,
      durationSeconds: duration,
      paceSecondsPerMeter: seg.deltaXMeters > 0 ? duration / seg.deltaXMeters : 0,
      elapsedAtEndSeconds: state.elapsedSeconds
    });
    curve.push({
      distanceMetersFromStart: seg.endMeters,
      referenceElapsedSeconds: state.elapsedSeconds
    });
  }

  return { state, segments: results, distanceElapsedCurve: curve };
}

/** Interpolate elapsed seconds at an arbitrary distance along a distance→elapsed curve. */
export function interpolateElapsedAtDistance(
  curve: Array<{ distanceMetersFromStart: number; referenceElapsedSeconds: number }>,
  distanceMeters: number
): number {
  if (curve.length === 0) {
    return 0;
  }
  const d = Math.max(0, distanceMeters);
  if (d <= curve[0]!.distanceMetersFromStart) {
    return curve[0]!.referenceElapsedSeconds;
  }
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]!;
    const next = curve[i]!;
    if (d <= next.distanceMetersFromStart) {
      const span = next.distanceMetersFromStart - prev.distanceMetersFromStart;
      const t = span > 0 ? (d - prev.distanceMetersFromStart) / span : 0;
      return prev.referenceElapsedSeconds + t * (next.referenceElapsedSeconds - prev.referenceElapsedSeconds);
    }
  }
  return curve[curve.length - 1]!.referenceElapsedSeconds;
}
