import test from "node:test";
import assert from "node:assert/strict";
import type { ActivityGradeProfile, ActivityHistoryRef } from "@crewcue/contracts";
import { buildRunnerProfile } from "./runnerProfile.js";
import { personalTerrainFrom, terrainFactorAt, TERRAIN_FACTOR_RANGE } from "./personalTerrain.js";
import { gradeCostMultiplier } from "./simulate.js";

const shared = (grade: number) => gradeCostMultiplier(grade, 1, 1);

/**
 * A run whose time at each grade is `pace × shared cost × factor(grade)`; climbs at or above
 * `hikeFrom` are hiked. `meters` per grade step.
 */
function run(opts: { meters: number; hikeFrom: number; factor: (grade: number) => number; pace?: number }): ActivityHistoryRef {
  const pace = opts.pace ?? 0.4;
  const bins = [];
  for (let pct = -25; pct <= 25; pct += 1) {
    const g = pct / 100;
    const seconds = opts.meters * pace * shared(g) * opts.factor(g);
    const hiking = g >= opts.hikeFrom;
    bins.push({
      gradePercent: pct,
      runMeters: hiking ? 0 : opts.meters,
      runSeconds: hiking ? 0 : seconds,
      hikeMeters: hiking ? opts.meters : 0,
      hikeSeconds: hiking ? seconds : 0
    });
  }
  const gradeProfile: ActivityGradeProfile = {
    version: 1,
    quality: "typical",
    smoothingMeters: 30,
    elevationNoiseMeters: 0.29,
    medianPointSpacingMeters: 2,
    labelSource: "cadence",
    movingMeters: bins.reduce((s, b) => s + b.runMeters + b.hikeMeters, 0),
    movingSeconds: bins.reduce((s, b) => s + b.runSeconds + b.hikeSeconds, 0),
    bins
  };
  return {
    id: `r${Math.random()}`,
    source: "fit_upload",
    externalId: `x${Math.random()}`,
    recordedAt: "2026-06-01T12:00:00.000Z",
    ingestedAt: "2026-06-02T00:00:00.000Z",
    distanceMeters: gradeProfile.movingMeters,
    elapsedSeconds: gradeProfile.movingSeconds,
    gradeProfile
  };
}

test("no grade profiles, no personal terrain", () => {
  const plain = { ...run({ meters: 100, hikeFrom: 0.12, factor: () => 1 }) };
  delete plain.gradeProfile;
  assert.equal(personalTerrainFrom([plain]), null);
});

test("a strong hiker who brakes on runnable descents is learned, with their switch grade", () => {
  // Hikes from 10%; hiking grades take 15% less time than the shared curve, runnable descents 10% more.
  const factor = (g: number) => (g >= 0.1 ? 0.85 : g <= -0.04 && g > -0.15 ? 1.1 : 1);
  const terrain = personalTerrainFrom([1, 2, 3].map(() => run({ meters: 400, hikeFrom: 0.1, factor })));
  assert.ok(terrain);
  assert.equal(terrain.switchGrade, 0.1);
  assert.equal(terrain.basedOnRuns, 3);
  const [flat, climb, hike, descent, steep] = terrain.factors;
  // Factors are relative to each run's own level, so they sit around the run's average.
  assert.ok(hike! < flat! - 0.1, `hike ${hike} vs flat ${flat}`);
  assert.ok(descent! > flat! + 0.05, `descent ${descent} vs flat ${flat}`);
  assert.ok(Math.abs(climb! - flat!) < 0.03 && Math.abs(steep! - flat!) < 0.03);
  assert.equal(terrainFactorAt(0.2, terrain), hike);
  assert.equal(terrainFactorAt(-0.08, terrain), descent);
  assert.equal(terrainFactorAt(0.2, undefined), 1);
});

test("little data stays near the shared curve, and factors are capped", () => {
  const tiny = personalTerrainFrom([run({ meters: 5, hikeFrom: 0.12, factor: (g) => (g >= 0.12 ? 0.5 : 1) })]);
  assert.ok(tiny);
  assert.ok(tiny.factors[2]! > 0.85, `hike factor with 5 m per grade: ${tiny.factors[2]}`);
  const wild = personalTerrainFrom([run({ meters: 5000, hikeFrom: 0.12, factor: (g) => (g >= 0.12 ? 0.2 : 1) })]);
  assert.ok(wild);
  assert.ok(wild.factors.every((f) => f >= TERRAIN_FACTOR_RANGE.min && f <= TERRAIN_FACTOR_RANGE.max));
});

test("the runner profile carries personal terrain only with the flag on", () => {
  const history = [1, 2].map(() => run({ meters: 400, hikeFrom: 0.1, factor: (g) => (g >= 0.1 ? 0.85 : 1) }));
  const before = process.env.PERSONAL_TERRAIN_FACTORS;
  try {
    delete process.env.PERSONAL_TERRAIN_FACTORS;
    assert.equal(buildRunnerProfile({ history, courseDistanceMeters: 50_000 }).personalTerrain, undefined);
    process.env.PERSONAL_TERRAIN_FACTORS = "on";
    const profile = buildRunnerProfile({ history, courseDistanceMeters: 50_000 });
    assert.ok(profile.personalTerrain);
    assert.match(profile.explanation, /Climbing and descending learned from 2 of your runs/);
  } finally {
    if (before === undefined) delete process.env.PERSONAL_TERRAIN_FACTORS;
    else process.env.PERSONAL_TERRAIN_FACTORS = before;
  }
});
