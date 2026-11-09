import test from "node:test";
import assert from "node:assert/strict";
import type { RaceCourse, RaceRoomProjectionCore } from "@crewcue/contracts";
import { buildDerivedMetricsFromPolyline, checkpointsWithProjectedDistances } from "@crewcue/map-core";
import {
  advanceLiveRatio,
  liveRemainingScale,
  recomputeRaceProjection,
  stopHabitRatio,
  type ProjectionPing,
  type ProjectionPreviousState
} from "./raceProjection.js";
import { LIVE_BIAS_A, LIVE_BIAS_B } from "./projectionTuning.js";

const START_MS = Date.parse("2026-08-01T06:00:00.000Z");
const PACE_S_PER_KM = 600; // plan: 10:00/km on flat
const LAT0 = 40;
const DEG_PER_M = 1 / 111_195; // latitude degrees per meter (spherical earth)

function withFlag<T>(on: boolean, fn: () => T): T {
  const before = process.env.PROJECTION_TUNED_CONSTANTS;
  if (on) {
    process.env.PROJECTION_TUNED_CONSTANTS = "1";
  } else {
    delete process.env.PROJECTION_TUNED_CONSTANTS;
  }
  try {
    return fn();
  } finally {
    if (before === undefined) {
      delete process.env.PROJECTION_TUNED_CONSTANTS;
    } else {
      process.env.PROJECTION_TUNED_CONSTANTS = before;
    }
  }
}

/** Straight 20 km course north from LAT0 with an aid station at 10 km. */
function course(opts: { aidPlannedStopSeconds?: number; planLogSigma?: number; baseline?: boolean } = {}) {
  const pt = (m: number) => ({ latitude: LAT0 + m * DEG_PER_M, longitude: -105 });
  const routeMetricPoints = [0, 5000, 10_000, 15_000, 20_000].map(pt);
  const base: RaceCourse = {
    checkpoints: [
      { id: "start", ...pt(0) },
      { id: "aid", ...pt(10_000), ...(opts.aidPlannedStopSeconds ? { plannedStopSeconds: opts.aidPlannedStopSeconds } : {}) },
      { id: "finish", ...pt(20_000) }
    ]
  };
  const checkpoints = checkpointsWithProjectedDistances(base.checkpoints, routeMetricPoints);
  const derivedMetrics = buildDerivedMetricsFromPolyline(routeMetricPoints);
  const length = derivedMetrics.canonicalDistanceMeters;
  const c: RaceCourse = { ...base, checkpoints, derivedMetrics };
  if (opts.baseline) {
    c.baselineTrack = {
      points: [0, 0.25, 0.5, 0.75, 1].map((f) => ({
        distanceMetersFromStart: f * length,
        referenceElapsedSeconds: (f * length * PACE_S_PER_KM) / 1000 + (f === 0 ? 0 : 0)
      })),
      ...(opts.planLogSigma !== undefined ? { planLogSigma: opts.planLogSigma } : {})
    };
  }
  return { course: c, routeMetricPoints, pt, length };
}

type Leg = { meters: number; seconds: number };

/**
 * Feed pings every `everySeconds` along `legs` (distance covered over time; meters 0 = standing
 * still) and return the final projection. A leg with meters 0 at the aid is a stop.
 */
function run(
  setup: ReturnType<typeof course>,
  legs: Leg[],
  everySeconds = 180
): { core: RaceRoomProjectionCore; state: ProjectionPreviousState } {
  let at = 0;
  let pos = 0;
  let previous: ProjectionPreviousState | null = null;
  let previousPing: ProjectionPing | null = null;
  let core: RaceRoomProjectionCore | undefined;
  let state: ProjectionPreviousState | undefined;
  let n = 0;
  for (const leg of legs) {
    const steps = Math.max(1, Math.round(leg.seconds / everySeconds));
    for (let i = 0; i < steps; i++) {
      at += leg.seconds / steps;
      pos += leg.meters / steps;
      const ping: ProjectionPing = {
        pingId: `p${n++}`,
        ...setup.pt(pos),
        recordedAt: new Date(START_MS + at * 1000).toISOString()
      };
      const out = recomputeRaceProjection({
        roomId: "room",
        activatedAt: new Date(START_MS).toISOString(),
        course: setup.course,
        plannedPaceSecondsPerKm: PACE_S_PER_KM,
        ping,
        previousPing,
        previous,
        routeMetricPoints: setup.routeMetricPoints
      });
      core = out.projection;
      state = out.state;
      previous = out.state;
      previousPing = ping;
    }
  }
  return { core: core!, state: state! };
}

const finishElapsed = (core: RaceRoomProjectionCore) => (Date.parse(core.etaFinishPlanIso) - START_MS) / 1000;

test("trust: a cold-start plan (σ 0.30) gives way to live pace sooner than a history plan (σ 0.12)", () => {
  const cold = liveRemainingScale({ ratio: 0.8, seen: 0.3, planLogSigma: 0.3 });
  const history = liveRemainingScale({ ratio: 0.8, seen: 0.3, planLogSigma: 0.12 });
  assert.ok(cold < history, `cold ${cold} should be closer to the live 0.8 than history ${history}`);
});

test("bias correction lengthens remaining time early and shortens it late", () => {
  const early = liveRemainingScale({ ratio: 1, seen: 0.05, planLogSigma: 0.12 });
  const late = liveRemainingScale({ ratio: 1, seen: 0.95, planLogSigma: 0.12 });
  assert.ok(early > 1, `early ${early}`);
  assert.ok(late < 1, `late ${late}`);
  assert.ok(Math.abs(early - Math.exp(LIVE_BIAS_A + LIVE_BIAS_B * 0.05)) < 1e-12);
});

test("stop habit: no planned stops passed → 1; shrinks a long stop toward plan", () => {
  assert.equal(stopHabitRatio([]), 1);
  assert.ok(Math.abs(stopHabitRatio([{ actualSeconds: 1200, plannedSeconds: 600 }]) - 4 / 3) < 1e-12);
});

test("live ratio skips pre-start samples and the pre-race bootstrap, and counts time once", () => {
  const plannedElapsedAt = (m: number) => (m * PACE_S_PER_KM) / 1000;
  const common = { activatedAtMs: START_MS, plannedStopSecondsInInterval: 0, plannedElapsedAt };
  assert.equal(
    advanceLiveRatio({ ...common, previous: undefined, recordedAtMs: START_MS - 60_000, progressMeters: 100, hasPreviousPing: true }),
    undefined
  );
  assert.equal(
    advanceLiveRatio({ ...common, previous: undefined, recordedAtMs: START_MS + 60_000, progressMeters: 0, hasPreviousPing: false }),
    undefined,
    "bootstrap at the start line folds nothing"
  );
  const first = advanceLiveRatio({ ...common, previous: undefined, recordedAtMs: START_MS + 600_000, progressMeters: 1000, hasPreviousPing: false })!;
  assert.deepEqual([first.actualSeconds, first.plannedSeconds], [600, 600]);
  const replay = advanceLiveRatio({ ...common, previous: first, recordedAtMs: START_MS + 600_000, progressMeters: 1000, hasPreviousPing: true });
  assert.equal(replay, first);
});

test("flag off: no live ETAs and no live ratio state (today's output)", () => {
  const setup = course();
  const { core, state } = withFlag(false, () => run(setup, [{ meters: 8000, seconds: 3600 }]));
  assert.equal(core.remainingCheckpointEtas, undefined);
  assert.equal(state.liveRatio, undefined);
});

test("a runner 20% faster or slower than plan moves the finish ETA the right way", () => {
  const setup = course();
  const planFinish = (setup.length * PACE_S_PER_KM) / 1000;
  const fast = withFlag(true, () => run(setup, [{ meters: 8000, seconds: 8 * 600 * 0.8 }]));
  const slow = withFlag(true, () => run(setup, [{ meters: 8000, seconds: 8 * 600 * 1.2 }]));
  const fastFinish = finishElapsed(fast.core);
  const slowFinish = finishElapsed(slow.core);
  assert.ok(fastFinish < planFinish * 0.95, `fast ${fastFinish} vs plan ${planFinish}`);
  assert.ok(slowFinish > planFinish * 1.05, `slow ${slowFinish} vs plan ${planFinish}`);
  // Live remaining ETAs are written for the checkpoints ahead.
  assert.deepEqual(fast.core.remainingCheckpointEtas?.map((r) => r.checkpointId), ["aid", "finish"]);
});

test("a plan without σ behaves like σ 0.12", () => {
  const legs = [{ meters: 8000, seconds: 8 * 600 * 0.8 }];
  const missing = withFlag(true, () => run(course({ baseline: true }), legs));
  const explicit = withFlag(true, () => run(course({ baseline: true, planLogSigma: 0.12 }), legs));
  assert.equal(missing.core.etaFinishPlanIso, explicit.core.etaFinishPlanIso);
  const cold = withFlag(true, () => run(course({ baseline: true, planLogSigma: 0.3 }), legs));
  assert.ok(finishElapsed(cold.core) < finishElapsed(explicit.core), "the looser plan follows the fast runner more");
});

test("a crew-planned stop is counted once; an unplanned stop stays in the pace ratio", () => {
  const onPace = (meters: number) => ({ meters, seconds: (meters * PACE_S_PER_KM) / 1000 });
  const stop = { meters: 0, seconds: 900 }; // 15 minutes at the aid
  const legs = [onPace(10_000), stop, onPace(2000)];

  const planned = withFlag(true, () => run(course({ aidPlannedStopSeconds: 900 }), legs, 60));
  const unplanned = withFlag(true, () => run(course(), legs, 60));
  const aidRow = planned.core.checkpointSplits.find((r) => r.checkpointId === "aid")!;
  assert.ok((aidRow.totalActualStopSeconds ?? 0) > 600, "stop detected at the aid");

  // Planned: the stop leaves the moving-pace ratio, so the rest of the race is projected on pace.
  // Unplanned: the 15 minutes spread over the remaining course as a slower pace.
  const plannedFinish = finishElapsed(planned.core);
  const unplannedFinish = finishElapsed(unplanned.core);
  assert.ok(unplannedFinish > plannedFinish, `unplanned ${unplannedFinish} > planned ${plannedFinish}`);
  const ratio = planned.state.liveRatio!.actualSeconds / planned.state.liveRatio!.plannedSeconds;
  assert.ok(Math.abs(ratio - 1) < 0.05, `moving ratio ${ratio} stays ~1 when the planned stop is excluded`);
});

test("a fast first 15% (crowded UTMB-style start) is not extrapolated across the whole race", () => {
  const setup = course({ baseline: true, planLogSigma: 0.12 });
  const planFinish = (setup.length * PACE_S_PER_KM) / 1000;
  const early = 0.15 * setup.length;
  const { core } = withFlag(true, () => run(setup, [{ meters: early, seconds: (early * PACE_S_PER_KM * 0.8) / 1000 }]));
  const naive = 0.8 * planFinish; // raw pace: "20% fast all day"
  const projected = finishElapsed(core);
  assert.ok(projected > naive + 0.08 * planFinish, `projected ${projected} vs naive ${naive}`);
  assert.ok(projected < planFinish, "but still credits some of the fast start");
});

test("arrival windows appear on live ETAs only when a calibrated table exists", async () => {
  const { setArrivalWindowTableForTests, WINDOW_PROGRESS_BANDS } = await import("./arrivalWindows.js");
  const setup = course({ baseline: true, planLogSigma: 0.12 });
  const legs = [{ meters: 6000, seconds: 6 * 600 }];
  setArrivalWindowTableForTests(null);
  try {
    const none = withFlag(true, () => run(setup, legs));
    assert.equal(none.core.etaFinishWindow, undefined);
    assert.ok(none.core.remainingCheckpointEtas?.every((r) => r.window === undefined));
    const bands = (["next", "finish"] as const).flatMap((target) =>
      WINDOW_PROGRESS_BANDS.flatMap(([lo, hi]) =>
        (["coldStart", "coarseHistory", "similarHistory"] as const).map((sigmaTier) => ({
          target, progressLo: lo, progressHi: hi, sigmaTier, hasHistory: false, q10: -0.1, q90: 0.15, coverage: 0.8, samples: 50
        }))
      )
    );
    setArrivalWindowTableForTests({ source: "test", bands });
    const withTable = withFlag(true, () => run(setup, legs));
    const finish = withTable.core.etaFinishWindow!;
    assert.ok(Date.parse(finish.earliestIso) <= Date.parse(withTable.core.etaFinishPlanIso));
    assert.ok(Date.parse(finish.latestIso) >= Date.parse(withTable.core.etaFinishPlanIso));
    for (const eta of withTable.core.remainingCheckpointEtas ?? []) {
      assert.ok(eta.window!.earliestElapsedSeconds <= eta.liveProjectedElapsedSeconds);
      assert.ok(eta.window!.latestElapsedSeconds >= eta.liveProjectedElapsedSeconds);
    }
    // Flag off: no windows even with a table.
    const off = withFlag(false, () => run(setup, legs));
    assert.equal(off.core.etaFinishWindow, undefined);
  } finally {
    setArrivalWindowTableForTests(undefined);
  }
});
