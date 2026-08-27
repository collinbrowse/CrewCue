/**
 * Three deterministic scenario re-sims for pacing bands.
 */
import type { RaceCourseBaselineTrack, RaceCourseCheckpoint } from "@crewcue/contracts";
import {
  SCENARIO_AGGRESSIVE,
  SCENARIO_CONSERVATIVE,
  SCENARIO_EXPECTED
} from "./constants.js";
import type { CourseMicroSegment } from "./courseMesh.js";
import type { RunnerProfile } from "./runnerProfile.js";
import {
  interpolateElapsedAtDistance,
  simulateMovingTime,
  type ScenarioKnobs,
  type SimulationResult
} from "./simulate.js";

export type ScenarioKind = "expected" | "conservative" | "aggressive";

export const SCENARIO_KNOBS: Record<ScenarioKind, ScenarioKnobs> = {
  expected: SCENARIO_EXPECTED,
  conservative: SCENARIO_CONSERVATIVE,
  aggressive: SCENARIO_AGGRESSIVE
};

export type ScenarioSimulationBundle = {
  expected: SimulationResult;
  conservative: SimulationResult;
  aggressive: SimulationResult;
};

export function runScenarioSims(input: {
  segments: CourseMicroSegment[];
  profile: RunnerProfile;
  fromDistanceMeters?: number;
  /** When set, used as the starting fatigue/elapsed for remaining-course live re-sim. */
  initialStateForRemaining?: {
    workCum: number;
    descentCum: number;
    /** Actual race elapsed at resume (replaces model elapsed for remaining ETA clock). */
    actualElapsedSeconds: number;
  };
}): ScenarioSimulationBundle {
  const fromDistance = input.fromDistanceMeters ?? 0;

  const run = (knobs: ScenarioKnobs): SimulationResult => {
    if (input.initialStateForRemaining) {
      return simulateMovingTime({
        segments: input.segments,
        profile: input.profile,
        knobs,
        fromDistanceMeters: fromDistance,
        initialState: {
          workCum: input.initialStateForRemaining.workCum,
          descentCum: input.initialStateForRemaining.descentCum,
          elapsedSeconds: input.initialStateForRemaining.actualElapsedSeconds
        }
      });
    }
    return simulateMovingTime({
      segments: input.segments,
      profile: input.profile,
      knobs,
      fromDistanceMeters: fromDistance
    });
  };

  return {
    expected: run(SCENARIO_KNOBS.expected),
    conservative: run(SCENARIO_KNOBS.conservative),
    aggressive: run(SCENARIO_KNOBS.aggressive)
  };
}

export function elapsedAtCheckpoints(
  sim: SimulationResult,
  checkpoints: RaceCourseCheckpoint[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const cp of checkpoints) {
    const d = cp.distanceMetersFromStart;
    if (typeof d !== "number" || !Number.isFinite(d)) {
      continue;
    }
    map.set(cp.id, Math.max(0, Math.round(interpolateElapsedAtDistance(sim.distanceElapsedCurve, d))));
  }
  return map;
}

export function baselineTrackFromSimulation(sim: SimulationResult): RaceCourseBaselineTrack {
  const points = sim.distanceElapsedCurve.map((row) => ({
    distanceMetersFromStart: row.distanceMetersFromStart,
    referenceElapsedSeconds: row.referenceElapsedSeconds
  }));
  const cleaned: typeof points = [];
  for (const p of points) {
    const last = cleaned[cleaned.length - 1];
    if (last && p.distanceMetersFromStart <= last.distanceMetersFromStart + 0.05) {
      cleaned[cleaned.length - 1] = {
        distanceMetersFromStart: Math.max(last.distanceMetersFromStart + 0.1, p.distanceMetersFromStart),
        referenceElapsedSeconds: Math.max(last.referenceElapsedSeconds + 0.1, p.referenceElapsedSeconds)
      };
    } else {
      cleaned.push(p);
    }
  }
  return { points: cleaned };
}

/** Accumulate expected-scenario fatigue from course start to progressMeters. */
export function fatigueStateAtProgress(input: {
  segments: CourseMicroSegment[];
  profile: RunnerProfile;
  progressMeters: number;
}): { workCum: number; descentCum: number; modelElapsedSeconds: number } {
  const progress = Math.max(0, input.progressMeters);
  const covered = input.segments
    .map((seg) => {
      if (seg.startMeters >= progress) {
        return null;
      }
      const end = seg.startMeters + seg.deltaXMeters;
      const useEnd = Math.min(end, progress);
      const frac = seg.deltaXMeters > 0 ? (useEnd - seg.startMeters) / seg.deltaXMeters : 0;
      return {
        ...seg,
        deltaXMeters: useEnd - seg.startMeters,
        deltaZMeters: seg.deltaZMeters * frac
      };
    })
    .filter((s): s is CourseMicroSegment => s !== null && s.deltaXMeters > 0);

  const toProgress = simulateMovingTime({
    segments: covered,
    profile: input.profile,
    knobs: SCENARIO_KNOBS.expected
  });
  return {
    workCum: toProgress.state.workCum,
    descentCum: toProgress.state.descentCum,
    modelElapsedSeconds: toProgress.state.elapsedSeconds
  };
}
