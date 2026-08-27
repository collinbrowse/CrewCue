/**
 * Segment-by-segment moving-time simulation (physiology micro-model).
 */
import {
  ALTITUDE_PENALTY_PER_300M,
  ALTITUDE_PENALTY_START_METERS,
  TECHNICAL_DOWNHILL_EXTRA,
  TECHNICAL_DOWNHILL_GRADE
} from "./constants.js";
import type { CourseMicroSegment } from "./courseMesh.js";
import type { RunnerProfile } from "./runnerProfile.js";

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
 * Minetti-inspired relative metabolic cost vs flat (g = rise/run).
 * Flat → 1. Polynomial approximation for |g| ≤ 0.45.
 */
export function minettiRelativeCost(grade: number): number {
  const g = Math.max(-0.45, Math.min(0.45, grade));
  // Relative cost ≈ 1 + c1 g + c2 g² + c3 g³ (running-oriented heuristic).
  return Math.max(0.55, 1 + 3.6 * g + 14 * g * g + 22 * g * g * g);
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

export function gradeCostMultiplier(grade: number, terrainEfficiency: number): number {
  let m = minettiRelativeCost(grade) * terrainEfficiency;
  if (grade < TECHNICAL_DOWNHILL_GRADE) {
    m *= TECHNICAL_DOWNHILL_EXTRA;
  }
  return Math.max(0.5, m);
}

function segmentDurationSeconds(input: {
  segment: CourseMicroSegment;
  profile: RunnerProfile;
  knobs: ScenarioKnobs;
  state: SimulationState;
}): { duration: number; workAdd: number; descentAdd: number } {
  const { segment, profile, knobs, state } = input;
  const mGrade = gradeCostMultiplier(segment.grade, profile.terrainEfficiency);
  const fAlt = altitudeFactor(segment.altitudeMeters, knobs.altitudePenaltyMultiplier);
  const c = Math.max(1, segment.surfaceComplexity);
  const gapSpm = profile.gapSecondsPerMeter * knobs.gapMultiplier;
  const vBase = 1 / gapSpm;
  const vSegmentBase = vBase / (mGrade * c * Math.max(0.7, fAlt));
  const gamma1 = profile.gamma1 * knobs.gamma1Multiplier;
  const gamma2 = profile.gamma2 * knobs.gamma2Multiplier;
  const fatigue = 1 + gamma1 * state.workCum + gamma2 * state.descentCum;
  const paceSpm = (1 / Math.max(0.2, vSegmentBase)) * Math.max(1, fatigue);
  const duration = paceSpm * segment.deltaXMeters;
  const workAdd = mGrade * segment.deltaXMeters;
  const descentAdd = Math.max(0, -segment.grade) * segment.deltaXMeters;
  return { duration, workAdd, descentAdd };
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
}): SimulationResult {
  const fromDistance = Math.max(0, input.fromDistanceMeters ?? 0);
  let state: SimulationState = input.initialState
    ? { ...input.initialState }
    : { workCum: 0, descentCum: 0, elapsedSeconds: 0 };

  // If resuming mid-course without initial fatigue, warm up work/descent over skipped segments.
  if (fromDistance > 0 && !input.initialState) {
    for (const segment of input.segments) {
      const endMeters = segment.startMeters + segment.deltaXMeters;
      if (endMeters <= fromDistance + 1e-6) {
        const partial = segmentDurationSeconds({
          segment,
          profile: input.profile,
          knobs: input.knobs,
          state
        });
        state.workCum += partial.workAdd;
        state.descentCum += partial.descentAdd;
        state.elapsedSeconds += partial.duration;
      } else if (segment.startMeters < fromDistance) {
        const frac = (fromDistance - segment.startMeters) / segment.deltaXMeters;
        const clipped: CourseMicroSegment = {
          ...segment,
          deltaXMeters: fromDistance - segment.startMeters,
          deltaZMeters: segment.deltaZMeters * frac
        };
        const partial = segmentDurationSeconds({
          segment: clipped,
          profile: input.profile,
          knobs: input.knobs,
          state
        });
        state.workCum += partial.workAdd;
        state.descentCum += partial.descentAdd;
        state.elapsedSeconds += partial.duration;
      }
    }
    // Elapsed at resume is "actual" only when caller sets initialState; for warm-up we keep model elapsed.
  }

  const results: SegmentPaceResult[] = [];
  const curve: SimulationResult["distanceElapsedCurve"] = [
    {
      distanceMetersFromStart: fromDistance,
      referenceElapsedSeconds: state.elapsedSeconds
    }
  ];

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

    const { duration, workAdd, descentAdd } = segmentDurationSeconds({
      segment: seg,
      profile: input.profile,
      knobs: input.knobs,
      state
    });
    state.workCum += workAdd;
    state.descentCum += descentAdd;
    state.elapsedSeconds += duration;
    results.push({
      segmentIndex: seg.index,
      startMeters: seg.startMeters,
      endMeters: seg.startMeters + seg.deltaXMeters,
      durationSeconds: duration,
      paceSecondsPerMeter: duration / seg.deltaXMeters,
      elapsedAtEndSeconds: state.elapsedSeconds
    });
    curve.push({
      distanceMetersFromStart: seg.startMeters + seg.deltaXMeters,
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
