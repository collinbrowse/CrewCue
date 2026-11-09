import test from "node:test";
import assert from "node:assert/strict";
import { measureSlowdownSlope, personalSlowdownSlope, slowdownFromTimedTrack, type TimedSection } from "./runnerSlowdown.js";
import { measuredPlanLogSigma, stopStats, type FinishedEffort } from "./finishedEffortStore.js";
import { buildRunnerProfile } from "./pacingEstimate/microModel/runnerProfile.js";

/** Sections of a course where pace drifts by `slope` across the race (section time ∝ 1 + slope·(x − 0.5)). */
function sections(lengthMeters: number, count: number, slope: number): TimedSection[] {
  return Array.from({ length: count }, (_, i) => {
    const start = (i * lengthMeters) / count;
    const end = ((i + 1) * lengthMeters) / count;
    const x = (start + end) / 2 / lengthMeters;
    return { startMeters: start, endMeters: end, plannedSeconds: 1000, actualSeconds: 1000 * 1.3 * (1 + slope * (x - 0.5)) };
  });
}

test("measures the slowdown slope, independent of overall pace", () => {
  assert.ok(Math.abs(measureSlowdownSlope(sections(80_000, 8, 0.3), 80_000)! - 0.3) < 1e-9);
  assert.ok(Math.abs(measureSlowdownSlope(sections(80_000, 8, -0.1), 80_000)! + 0.1) < 1e-9);
});

test("short, sparse or patchy efforts give no slope", () => {
  assert.equal(measureSlowdownSlope(sections(20_000, 8, 0.3), 20_000), null, "under 30 km");
  assert.equal(measureSlowdownSlope(sections(80_000, 2, 0.3), 80_000), null, "fewer than 3 sections");
  assert.equal(measureSlowdownSlope(sections(80_000, 8, 0.3).slice(0, 5), 80_000), null, "under 80% covered");
});

test("shrinkage: no races → 0.24; one race moves a third; many converge; short runs ignored", () => {
  assert.equal(personalSlowdownSlope([]).slope, 0.24);
  const one = personalSlowdownSlope([{ slope: 0.54, distanceMeters: 100_000 }]);
  assert.ok(Math.abs(one.slope - (2 * 0.24 + 0.54) / 3) < 1e-12);
  const many = personalSlowdownSlope(Array.from({ length: 20 }, () => ({ slope: 0.1, distanceMeters: 100_000 })));
  assert.ok(Math.abs(many.slope - 0.1) < 0.02);
  assert.equal(personalSlowdownSlope([{ slope: 0.6, distanceMeters: 10_000 }]).basedOn, 0);
  assert.equal(personalSlowdownSlope([{ slope: 5, distanceMeters: 100_000 }]).slope, 0.6, "clamped");
});

test("a timed 40 km upload that slows down measures a positive slope", () => {
  const points = [];
  let t = Date.parse("2026-06-01T06:00:00Z");
  for (let i = 0; i <= 400; i += 1) {
    const x = i / 400;
    // ~100 m per step on flat ground; seconds per step grow from 40 to 80 across the run.
    points.push({ latitude: 40 + i * 0.0009, longitude: -105, elevationMeters: 1600, timestampMs: t });
    t += (40 + 40 * x) * 1000;
  }
  const slope = slowdownFromTimedTrack(points)!;
  assert.ok(slope > 0.4, `slope ${slope}`);
  assert.equal(slowdownFromTimedTrack(points.map((p) => ({ ...p, timestampMs: null }))), null, "untimed");
});

function effort(i: number, overrides: Partial<FinishedEffort> = {}): FinishedEffort {
  return {
    roomId: `room-${i}`,
    athleteUserId: "a",
    finishedAt: "2026-06-01T12:00:00Z",
    courseLengthMeters: 50_000,
    actualFinishSeconds: 30_000,
    plannedFinishSeconds: 28_000,
    planLogError: i % 2 === 0 ? 0.1 : -0.1,
    planBranch: "coldStart",
    stops: [],
    ...overrides
  };
}

test("plan σ is measured per branch only once it has 20 finished rooms", () => {
  assert.deepEqual(measuredPlanLogSigma(Array.from({ length: 19 }, (_, i) => effort(i))), {});
  const measured = measuredPlanLogSigma(Array.from({ length: 20 }, (_, i) => effort(i)));
  assert.ok(Math.abs(measured.coldStart!.sigma - 0.1) < 1e-12);
  assert.equal(measured.coldStart!.rooms, 20);
  assert.equal(measured.similarHistory, undefined);
});

test("stop stats group by tag, race quarter and darkness", () => {
  const stats = stopStats([
    effort(1, { stops: [
      { checkpointId: "a", tags: ["aid"], plannedStopSeconds: 300, actualStopSeconds: 600, progress: 0.3, dark: false },
      { checkpointId: "b", tags: ["aid"], plannedStopSeconds: 300, actualStopSeconds: 400, progress: 0.4, dark: false },
      { checkpointId: "c", tags: [], plannedStopSeconds: 0, actualStopSeconds: 120, progress: 0.9, dark: true }
    ] })
  ]);
  const aid = stats.find((s) => s.tag === "aid")!;
  assert.equal(aid.progressBand, "25-50%");
  assert.equal(aid.stops, 2);
  assert.equal(aid.medianSeconds, 500);
  assert.ok(Math.abs(aid.medianRatioToPlan! - 5 / 3) < 1e-12);
  const untagged = stats.find((s) => s.tag === "untagged")!;
  assert.equal(untagged.dark, true);
  assert.equal(untagged.medianRatioToPlan, null);
});

test("the profile uses the runner's own slowdown and measured σ (tuned flag on only)", () => {
  const before = process.env.PROJECTION_TUNED_CONSTANTS;
  try {
    delete process.env.PROJECTION_TUNED_CONSTANTS;
    const off = buildRunnerProfile({ history: [], courseDistanceMeters: 50_000, slowdownObservations: [{ slope: 0.5, distanceMeters: 100_000 }] });
    assert.equal(off.slowdownSlope, 0);
    assert.equal(off.planBranch, "coldStart");
    process.env.PROJECTION_TUNED_CONSTANTS = "1";
    const on = buildRunnerProfile({
      history: [],
      courseDistanceMeters: 50_000,
      slowdownObservations: [{ slope: 0.5, distanceMeters: 100_000 }],
      planLogSigmaByBranch: { coldStart: 0.22 }
    });
    assert.ok(Math.abs(on.slowdownSlope - (2 * 0.24 + 0.5) / 3) < 1e-12);
    assert.equal(on.planLogSigma, 0.22);
    assert.match(on.explanation, /learned from 1 race you finished or uploaded/);
    const none = buildRunnerProfile({ history: [], courseDistanceMeters: 50_000 });
    assert.equal(none.slowdownSlope, 0.24);
    assert.equal(none.planLogSigma, 0.3);
  } finally {
    if (before === undefined) delete process.env.PROJECTION_TUNED_CONSTANTS;
    else process.env.PROJECTION_TUNED_CONSTANTS = before;
  }
});
