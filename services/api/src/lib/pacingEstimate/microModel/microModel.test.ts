import assert from "node:assert/strict";
import test from "node:test";
import {
  altitudeFactor,
  buildCourseMicroSegments,
  buildRunnerProfile,
  coldStartGapSecondsPerMeter,
  COLD_START_GAP_SECONDS_PER_MILE,
  estimatePacingMicroModelWithArtifacts,
  interpolateElapsedAtDistance,
  minettiRelativeCost,
  runScenarioSims,
  SCENARIO_EXPECTED,
  simulateMovingTime,
  SURFACE_COMPLEXITY
} from "./index.js";
import { METERS_PER_MILE } from "./constants.js";

test("cold-start GAP is 10:00 per mile", () => {
  assert.equal(COLD_START_GAP_SECONDS_PER_MILE, 600);
  assert.ok(Math.abs(coldStartGapSecondsPerMeter() * METERS_PER_MILE - 600) < 1e-9);
});

test("surface complexity is 1", () => {
  assert.equal(SURFACE_COMPLEXITY, 1);
});

test("minettiRelativeCost is 1 on flat and increases uphill", () => {
  assert.ok(Math.abs(minettiRelativeCost(0) - 1) < 1e-9);
  assert.ok(minettiRelativeCost(0.1) > minettiRelativeCost(0));
  assert.ok(minettiRelativeCost(-0.1) < minettiRelativeCost(0));
});

test("altitudeFactor is 1 below 1500m and penalizes above", () => {
  assert.equal(altitudeFactor(1200), 1);
  assert.ok(altitudeFactor(1800) < 1);
  assert.ok(altitudeFactor(1800, 1.15) <= altitudeFactor(1800, 1));
});

test("buildCourseMicroSegments creates ~100m chunks", () => {
  // ~1 km north-south line near equator-ish
  const points = [];
  for (let i = 0; i <= 20; i++) {
    points.push({
      latitude: 40 + i * 0.0009,
      longitude: -105,
      elevationMeters: 1600 + i * 5
    });
  }
  const segments = buildCourseMicroSegments(points);
  assert.ok(segments.length >= 5);
  assert.ok(segments.every((s) => s.surfaceComplexity === 1));
  assert.ok(segments.some((s) => s.grade > 0));
});

test("runner profile cold-start vs history", () => {
  const cold = buildRunnerProfile({ history: [], courseDistanceMeters: 50000 });
  assert.equal(cold.coldStart, true);
  assert.ok(Math.abs(cold.gapSecondsPerMeter - coldStartGapSecondsPerMeter()) < 1e-12);
  assert.ok(cold.gradeCostBlend > 0.4);

  const hist = buildRunnerProfile({
    courseDistanceMeters: 50000,
    history: [
      {
        id: "h1",
        source: "gpx_upload",
        externalId: "x1",
        recordedAt: "2026-01-01T00:00:00.000Z",
        ingestedAt: "2026-01-02T00:00:00.000Z",
        distanceMeters: 45000,
        elapsedSeconds: 45000 * coldStartGapSecondsPerMeter() * 0.95
      }
    ]
  });
  assert.equal(hist.coldStart, false);
  assert.ok(hist.gapSecondsPerMeter < cold.gapSecondsPerMeter);
  assert.ok(hist.gradeCostBlend < cold.gradeCostBlend);
});

test("history-backed hilly course is less pessimistic than full grade on trail pace", () => {
  const points = [];
  for (let i = 0; i <= 40; i++) {
    points.push({
      latitude: 39.5 + i * 0.0009,
      longitude: -106.5,
      elevationMeters: 2000 + i * 15
    });
  }
  const segments = buildCourseMicroSegments(points);
  const trailPace = 0.45; // ~12:00/mi wall-clock already includes hills
  const hist = buildRunnerProfile({
    courseDistanceMeters: 50000,
    history: [
      {
        id: "trail",
        source: "gpx_upload",
        externalId: "t1",
        recordedAt: "2026-01-01T00:00:00.000Z",
        ingestedAt: "2026-01-02T00:00:00.000Z",
        distanceMeters: 40000,
        elapsedSeconds: 40000 * trailPace
      }
    ]
  });
  const fullGrade = { ...hist, gradeCostBlend: 1 };
  const withBlend = runScenarioSims({ segments, profile: hist }).expected.state.elapsedSeconds;
  const withoutBlend = runScenarioSims({ segments, profile: fullGrade }).expected.state.elapsedSeconds;
  assert.ok(withBlend < withoutBlend * 0.92, "blend should cut double-counted climb cost");
});

test("100–250 mi course can use weekday training when no ultra-length history exists", () => {
  const hundredMiles = 160934;
  const weekday = {
    id: "weekday",
    source: "gpx_upload" as const,
    externalId: "w1",
    recordedAt: "2026-01-01T00:00:00.000Z",
    ingestedAt: "2026-01-02T00:00:00.000Z",
    distanceMeters: 16093, // ~10 mi (~0.1× of 100 mi)
    elapsedSeconds: 16093 * 0.4
  };
  const profile = buildRunnerProfile({ history: [weekday], courseDistanceMeters: hundredMiles });
  assert.equal(profile.coldStart, false);
  assert.deepEqual(profile.historyRefIds, ["weekday"]);
  assert.ok(Math.abs(profile.gapSecondsPerMeter - 0.4) < 1e-9);

  const twoFifty = 402336;
  const profile250 = buildRunnerProfile({
    history: [{ ...weekday, distanceMeters: 12000, elapsedSeconds: 12000 * 0.42 }],
    courseDistanceMeters: twoFifty
  });
  assert.equal(profile250.coldStart, false);
  assert.ok(Math.abs(profile250.gapSecondsPerMeter - 0.42) < 1e-9);
});

test("when a long effort exists, prefer it over a short road run", () => {
  const courseDistanceMeters = 50000;
  const long = {
    id: "long",
    source: "gpx_upload" as const,
    externalId: "l1",
    recordedAt: "2026-01-01T00:00:00.000Z",
    ingestedAt: "2026-01-02T00:00:00.000Z",
    distanceMeters: 45000,
    elapsedSeconds: 45000 * 0.5
  };
  const short = {
    id: "short",
    source: "gpx_upload" as const,
    externalId: "s1",
    recordedAt: "2026-01-01T00:00:00.000Z",
    ingestedAt: "2026-01-02T00:00:00.000Z",
    distanceMeters: 8000,
    elapsedSeconds: 8000 * 0.3
  };
  const both = buildRunnerProfile({ history: [long, short], courseDistanceMeters });
  assert.deepEqual(both.historyRefIds, ["long"]);
  assert.ok(Math.abs(both.gapSecondsPerMeter - 0.5) < 1e-9);
});

test("scenario bands: conservative >= expected >= aggressive", () => {
  const points = [];
  for (let i = 0; i <= 30; i++) {
    points.push({
      latitude: 39.5 + i * 0.001,
      longitude: -106.5,
      elevationMeters: 2000 + (i % 5) * 10
    });
  }
  const segments = buildCourseMicroSegments(points);
  const profile = buildRunnerProfile({ history: [], courseDistanceMeters: 50000 });
  const sims = runScenarioSims({ segments, profile });
  const exp = sims.expected.state.elapsedSeconds;
  const cons = sims.conservative.state.elapsedSeconds;
  const agg = sims.aggressive.state.elapsedSeconds;
  assert.ok(cons >= exp);
  assert.ok(exp >= agg);
});

test("simulateMovingTime warms up to mid-segment resume and clips the remaining segment", () => {
  const profile = buildRunnerProfile({ history: [], courseDistanceMeters: 300 });
  const segments = [
    {
      index: 0,
      startMeters: 0,
      deltaXMeters: 100,
      deltaZMeters: 10,
      grade: 0.1,
      altitudeMeters: 1550,
      surfaceComplexity: 1
    },
    {
      index: 1,
      startMeters: 100,
      deltaXMeters: 100,
      deltaZMeters: -20,
      grade: -0.2,
      altitudeMeters: 1545,
      surfaceComplexity: 1
    },
    {
      index: 2,
      startMeters: 200,
      deltaXMeters: 100,
      deltaZMeters: 0,
      grade: 0,
      altitudeMeters: 1540,
      surfaceComplexity: 1
    }
  ];

  const full = simulateMovingTime({ segments, profile, knobs: SCENARIO_EXPECTED });
  const resumed = simulateMovingTime({
    segments,
    profile,
    knobs: SCENARIO_EXPECTED,
    fromDistanceMeters: 150
  });

  assert.equal(resumed.segments.length, 2);
  assert.equal(resumed.segments[0]!.segmentIndex, 1);
  assert.equal(resumed.segments[0]!.startMeters, 150);
  assert.equal(resumed.segments[0]!.endMeters, 200);
  assert.equal(resumed.segments[1]!.segmentIndex, 2);
  assert.equal(resumed.distanceElapsedCurve[0]!.distanceMetersFromStart, 150);

  const expectedAtResume = interpolateElapsedAtDistance(full.distanceElapsedCurve, 150);
  assert.ok(Math.abs(resumed.distanceElapsedCurve[0]!.referenceElapsedSeconds - expectedAtResume) < 1e-9);
  assert.equal(
    resumed.distanceElapsedCurve[resumed.distanceElapsedCurve.length - 1]!.distanceMetersFromStart,
    300
  );
});

test("simulateMovingTime uses provided initial state as the live remaining clock origin", () => {
  const profile = buildRunnerProfile({ history: [], courseDistanceMeters: 300 });
  const segments = [
    {
      index: 0,
      startMeters: 0,
      deltaXMeters: 100,
      deltaZMeters: 5,
      grade: 0.05,
      altitudeMeters: 1600,
      surfaceComplexity: 1
    },
    {
      index: 1,
      startMeters: 100,
      deltaXMeters: 100,
      deltaZMeters: -10,
      grade: -0.1,
      altitudeMeters: 1595,
      surfaceComplexity: 1
    },
    {
      index: 2,
      startMeters: 200,
      deltaXMeters: 100,
      deltaZMeters: 0,
      grade: 0,
      altitudeMeters: 1590,
      surfaceComplexity: 1
    }
  ];
  const initialState = { workCum: 42, descentCum: 7, elapsedSeconds: 1234 };

  const resumed = simulateMovingTime({
    segments,
    profile,
    knobs: SCENARIO_EXPECTED,
    fromDistanceMeters: 150,
    initialState
  });

  assert.equal(resumed.distanceElapsedCurve[0]!.distanceMetersFromStart, 150);
  assert.equal(resumed.distanceElapsedCurve[0]!.referenceElapsedSeconds, 1234);
  assert.equal(resumed.segments[0]!.startMeters, 150);
  assert.equal(resumed.segments[0]!.endMeters, 200);
  assert.ok(resumed.state.elapsedSeconds > initialState.elapsedSeconds);
  assert.ok(resumed.state.workCum > initialState.workCum);
  assert.ok(resumed.state.descentCum > initialState.descentCum);
  assert.deepEqual(initialState, { workCum: 42, descentCum: 7, elapsedSeconds: 1234 });
});

test("estimatePacingMicroModelWithArtifacts returns parseable estimate + baseline", () => {
  const route = [];
  for (let i = 0; i <= 40; i++) {
    route.push({
      latitude: 40 + i * 0.0008,
      longitude: -105.2,
      elevationMeters: 1700 + i * 2
    });
  }
  const checkpoints = [
    { id: "start", latitude: route[0]!.latitude, longitude: route[0]!.longitude, distanceMetersFromStart: 0 },
    {
      id: "aid-1",
      latitude: route[20]!.latitude,
      longitude: route[20]!.longitude,
      distanceMetersFromStart: 2000,
      tags: ["aid" as const]
    },
    {
      id: "finish",
      latitude: route[40]!.latitude,
      longitude: route[40]!.longitude,
      distanceMetersFromStart: 4000
    }
  ];
  // Fix distances from mesh length roughly — use sequential
  const { estimate, baselineTrack } = estimatePacingMicroModelWithArtifacts({
    raceStartAt: "2026-08-01T06:00:00.000Z",
    checkpoints,
    history: [],
    routeMetricPoints: route,
    courseLengthMeters: 4000
  });
  assert.equal(estimate.coldStart, true);
  assert.ok(estimate.expectedFinishElapsedSeconds > 0);
  assert.ok(estimate.bands?.conservative);
  assert.ok(
    (estimate.bands!.conservative!.finishElapsedSeconds as number) >= estimate.expectedFinishElapsedSeconds
  );
  assert.ok(
    estimate.expectedFinishElapsedSeconds >= (estimate.bands!.aggressive!.finishElapsedSeconds as number)
  );
  assert.ok(baselineTrack.points.length >= 2);
  assert.match(estimate.explanation, /scenario/i);
});
