import assert from "node:assert/strict";
import test from "node:test";
import { parseActivityFile } from "./activityFile.js";
import { buildActivityGradeProfile, estimateElevationNoiseMeters, gradeProfileQuality } from "./activityGradeProfile.js";
import type { GpxTrackPoint } from "./courseParse.js";
import { encodeFitActivity } from "./fitTestEncoder.js";

const METERS_PER_DEGREE_LAT = 111_195;
const START_MS = Date.parse("2026-06-01T12:00:00Z");

type Leg = { meters: number; grade: number; speed: number; cadence?: number; stopSeconds?: number };

/** One point per second along a meridian, following the legs. `noise` adds ±noise m to elevation. */
function track(legs: Leg[], options: { noise?: number; cadence?: boolean } = {}): GpxTrackPoint[] {
  const points: GpxTrackPoint[] = [];
  let meters = 0;
  let elevation = 1000;
  let seconds = 0;
  let seed = 7;
  const jitter = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return ((seed / 2 ** 31) * 2 - 1) * (options.noise ?? 0);
  };
  const push = (cadence?: number) =>
    points.push({
      latitude: 45 + meters / METERS_PER_DEGREE_LAT,
      longitude: -120,
      elevationMeters: elevation + jitter(),
      timestampMs: START_MS + seconds * 1000,
      ...(options.cadence !== false && cadence !== undefined ? { cadence } : {})
    });
  push(legs[0]?.cadence);
  for (const leg of legs) {
    for (let s = 0; s < (leg.stopSeconds ?? 0); s += 1) {
      seconds += 1;
      push(0);
    }
    let left = leg.meters;
    while (left > 1e-9) {
      const horizontal = Math.min(leg.speed, left);
      meters += horizontal;
      elevation += horizontal * leg.grade;
      seconds += horizontal / leg.speed;
      left -= horizontal;
      push(leg.cadence);
    }
  }
  return points;
}

function totals(profile: NonNullable<ReturnType<typeof buildActivityGradeProfile>>, kind: "run" | "hike") {
  let meters = 0;
  let seconds = 0;
  let gradeMeters = 0;
  for (const bin of profile.bins) {
    const m = kind === "run" ? bin.runMeters : bin.hikeMeters;
    meters += m;
    seconds += kind === "run" ? bin.runSeconds : bin.hikeSeconds;
    gradeMeters += m * bin.gradePercent;
  }
  return { meters, seconds, meanGrade: meters > 0 ? gradeMeters / meters : 0 };
}

test("flat run lands at 0% and is all running", () => {
  const profile = buildActivityGradeProfile(track([{ meters: 1000, grade: 0, speed: 3, cadence: 85 }]));
  assert.ok(profile);
  assert.equal(profile.labelSource, "cadence");
  assert.deepEqual(
    profile.bins.map((bin) => bin.gradePercent),
    [0]
  );
  assert.equal(totals(profile, "hike").meters, 0);
  assert.ok(Math.abs(profile.movingMeters - 1000) <= 5);
  assert.ok(Math.abs(profile.movingSeconds - 333) <= 3);
});

test("run, hike and descent in one track stay apart", () => {
  const profile = buildActivityGradeProfile(
    track([
      { meters: 500, grade: 0, speed: 3, cadence: 86 },
      { meters: 600, grade: 0.15, speed: 1, cadence: 55 },
      { meters: 600, grade: -0.1, speed: 3.5, cadence: 88 }
    ])
  );
  assert.ok(profile);
  const hike = totals(profile, "hike");
  assert.ok(Math.abs(hike.meters - 600) <= 20, `hike meters ${hike.meters}`);
  assert.ok(Math.abs(hike.meanGrade - 15) <= 1, `hike grade ${hike.meanGrade}`);
  assert.ok(Math.abs(hike.seconds - 600) <= 20, `hike seconds ${hike.seconds}`);
  const run = totals(profile, "run");
  assert.ok(Math.abs(run.meters - 1100) <= 20, `run meters ${run.meters}`);
  const descent = profile.bins.filter((bin) => bin.gradePercent <= -9 && bin.gradePercent >= -11);
  const descentMeters = descent.reduce((sum, bin) => sum + bin.runMeters, 0);
  assert.ok(descentMeters >= 520, `descent meters at −10% ${descentMeters}`);
});

test("a stop is left out of moving time", () => {
  const moving = buildActivityGradeProfile(track([{ meters: 1000, grade: 0, speed: 3, cadence: 85 }]));
  const stopped = buildActivityGradeProfile(
    track([
      { meters: 500, grade: 0, speed: 3, cadence: 85 },
      { meters: 500, grade: 0, speed: 3, cadence: 85, stopSeconds: 120 }
    ])
  );
  assert.ok(moving && stopped);
  assert.ok(Math.abs(stopped.movingSeconds - moving.movingSeconds) <= 3);
});

test("a slow hike up a 40% wall still counts as moving", () => {
  const profile = buildActivityGradeProfile(
    track([
      { meters: 300, grade: 0, speed: 3, cadence: 85 },
      { meters: 300, grade: 0.4, speed: 0.4, cadence: 50 }
    ])
  );
  assert.ok(profile);
  const hike = totals(profile, "hike");
  assert.ok(hike.meters >= 270, `steep hike meters ${hike.meters}`);
  assert.ok(hike.meanGrade >= 36, `steep hike grade ${hike.meanGrade}`);
});

test("file quality sets the smoothing window", () => {
  const clean = buildActivityGradeProfile(track([{ meters: 2000, grade: 0.03, speed: 3, cadence: 85 }]));
  const noisy = buildActivityGradeProfile(
    track([{ meters: 2000, grade: 0.03, speed: 3, cadence: 85 }], { noise: 1.5 })
  );
  assert.ok(clean && noisy);
  assert.equal(clean.quality, "high");
  assert.equal(clean.smoothingMeters, 15);
  assert.equal(noisy.quality, "low");
  assert.equal(noisy.smoothingMeters, 40);
  // Even noisy, the grade lands near the true 3%.
  const run = totals(noisy, "run");
  assert.ok(Math.abs(run.meanGrade - 3) <= 1, `noisy grade ${run.meanGrade}`);
});

test("quality thresholds", () => {
  assert.equal(gradeProfileQuality(0.1, 3), "high");
  assert.equal(gradeProfileQuality(0.3, 3), "typical");
  assert.equal(gradeProfileQuality(0.1, 8), "typical");
  assert.equal(gradeProfileQuality(0.7, 3), "low");
  assert.equal(gradeProfileQuality(0.1, 20), "low");
  assert.equal(estimateElevationNoiseMeters([1, 2, 3, 4, 5, 6]), 0);
});

test("without cadence, a slow climb is hiking by the speed rule", () => {
  const profile = buildActivityGradeProfile(
    track(
      [
        { meters: 500, grade: 0, speed: 3 },
        { meters: 500, grade: 0.15, speed: 1 }
      ],
      { cadence: false }
    )
  );
  assert.ok(profile);
  assert.equal(profile.labelSource, "speed");
  assert.ok(Math.abs(totals(profile, "hike").meters - 500) <= 20);
});

test("cadence already in steps per minute isn't doubled", () => {
  const profile = buildActivityGradeProfile(
    track([
      { meters: 500, grade: 0, speed: 3, cadence: 172 },
      { meters: 500, grade: 0.15, speed: 1, cadence: 112 }
    ])
  );
  assert.ok(profile);
  assert.ok(Math.abs(totals(profile, "run").meters - 500) <= 20);
  assert.ok(Math.abs(totals(profile, "hike").meters - 500) <= 20);
});

test("untimed or flat-less tracks give no profile", () => {
  const untimed = track([{ meters: 1000, grade: 0, speed: 3 }]).map((point) => ({ ...point, timestampMs: null }));
  assert.equal(buildActivityGradeProfile(untimed), null);
  const noElevation = track([{ meters: 1000, grade: 0, speed: 3 }]).map((point) => ({
    ...point,
    elevationMeters: null
  }));
  assert.equal(buildActivityGradeProfile(noElevation), null);
  assert.equal(buildActivityGradeProfile(track([{ meters: 100, grade: 0, speed: 3 }])), null);
  const sparse = track([{ meters: 6000, grade: 0.02, speed: 3 }]).filter((_, index) => index % 30 === 0);
  assert.equal(buildActivityGradeProfile(sparse), null);
});

test("FIT cadence reaches the profile", () => {
  const points = track([
    { meters: 500, grade: 0, speed: 3, cadence: 86 },
    { meters: 500, grade: 0.15, speed: 1, cadence: 55 }
  ]);
  const bytes = encodeFitActivity({
    records: points.map((point) => ({
      timestampMs: point.timestampMs!,
      latitude: point.latitude,
      longitude: point.longitude,
      elevationMeters: point.elevationMeters!,
      ...(point.cadence !== undefined && point.cadence !== null ? { cadence: point.cadence } : {})
    }))
  });
  const parsed = parseActivityFile(bytes, "run.fit");
  assert.ok(parsed.points.some((point) => point.cadence === 86));
  const profile = buildActivityGradeProfile(parsed.points);
  assert.ok(profile);
  assert.equal(profile.labelSource, "cadence");
  assert.ok(Math.abs(totals(profile, "hike").meters - 500) <= 25);
});
