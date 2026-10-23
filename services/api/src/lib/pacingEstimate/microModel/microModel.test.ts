import assert from "node:assert/strict";
import test from "node:test";
import {
  altitudeFactor,
  buildCourseMicroSegments,
  buildRunnerProfile,
  coldStartGapSecondsPerMeter,
  COLD_START_GAP_SECONDS_PER_MILE,
  estimatePacingMicroModelWithArtifacts,
  minettiRelativeCost,
  runScenarioSims,
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

test("runner profile cold-start vs history (C4: full grade model applied both ways)", () => {
  const cold = buildRunnerProfile({ history: [], courseDistanceMeters: 50000 });
  assert.equal(cold.coldStart, true);
  assert.ok(Math.abs(cold.gapSecondsPerMeter - coldStartGapSecondsPerMeter()) < 1e-12);
  // C4 (#483): full physiological grade model applies to both cold start and history.
  assert.equal(cold.gradeCostBlend, 1);
  assert.equal(cold.enduranceFactor, 1);

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
  // Both blends are 1.0 now that C1 removes the double-counting the old damping compensated for.
  assert.equal(hist.gradeCostBlend, 1);
  assert.equal(cold.gradeCostBlend, hist.gradeCostBlend);
});

test("C1: elevation gain lowers the flat-equivalent GAP below raw trail pace", () => {
  const trailPace = 0.45; // wall-clock s/m over a hilly effort
  const flat = buildRunnerProfile({
    courseDistanceMeters: 50000,
    history: [
      {
        id: "flat",
        source: "gpx_upload",
        externalId: "f1",
        recordedAt: "2026-01-01T00:00:00.000Z",
        ingestedAt: "2026-01-02T00:00:00.000Z",
        distanceMeters: 40000,
        elapsedSeconds: 40000 * trailPace
        // no elevationGainMeters -> treated as already flat
      }
    ]
  });
  // Same pace + distance but 1200 m of climb: the climb is charged as flat-equivalent distance,
  // so the flat-equivalent GAP is faster than the raw trail pace.
  const hilly = buildRunnerProfile({
    courseDistanceMeters: 50000,
    history: [
      {
        id: "hilly",
        source: "gpx_upload",
        externalId: "h1",
        recordedAt: "2026-01-01T00:00:00.000Z",
        ingestedAt: "2026-01-02T00:00:00.000Z",
        distanceMeters: 40000,
        elapsedSeconds: 40000 * trailPace,
        elevationGainMeters: 1200
      }
    ]
  });
  assert.ok(Math.abs(flat.gapSecondsPerMeter - trailPace) < 1e-9);
  assert.ok(hilly.gapSecondsPerMeter < trailPace);
  assert.ok(hilly.gapSecondsPerMeter < flat.gapSecondsPerMeter);
});

test("C2: longer-than-typical course raises the endurance factor above 1", () => {
  const twentyK = {
    id: "20k",
    source: "gpx_upload" as const,
    externalId: "e1",
    recordedAt: "2026-01-01T00:00:00.000Z",
    ingestedAt: "2026-01-02T00:00:00.000Z",
    distanceMeters: 20000,
    elapsedSeconds: 20000 * 0.4
  };
  const hundredMiles = buildRunnerProfile({ history: [twentyK], courseDistanceMeters: 160934 });
  const similarLength = buildRunnerProfile({ history: [twentyK], courseDistanceMeters: 20000 });
  assert.ok(hundredMiles.enduranceFactor > 1.3, "100 mi from 20 km history should scale pace up");
  assert.equal(similarLength.enduranceFactor, 1);
});

test("C3+C4: hilly course is slower than an equal-length flat course for the same profile", () => {
  const flatPoints = [];
  const hillyPoints = [];
  for (let i = 0; i <= 40; i++) {
    flatPoints.push({ latitude: 39.5 + i * 0.0009, longitude: -106.5, elevationMeters: 2000 });
    hillyPoints.push({ latitude: 39.5 + i * 0.0009, longitude: -106.5, elevationMeters: 2000 + i * 15 });
  }
  const flatSegments = buildCourseMicroSegments(flatPoints);
  const hillySegments = buildCourseMicroSegments(hillyPoints);
  const profile = buildRunnerProfile({ history: [], courseDistanceMeters: 50000 });
  const flatFinish = runScenarioSims({ segments: flatSegments, profile }).expected.state.elapsedSeconds;
  const hillyFinish = runScenarioSims({ segments: hillySegments, profile }).expected.state.elapsedSeconds;
  assert.ok(hillyFinish > flatFinish, "full grade model should make the climb cost time");
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

test("PR D: aid ETA fallback emits only planned-stop checkpoints when none are aid-like", () => {
  const route = [];
  for (let i = 0; i <= 40; i++) {
    route.push({ latitude: 40 + i * 0.0008, longitude: -105.2, elevationMeters: 1700 + i * 2 });
  }
  // No checkpoint is aid-tagged or aid-named. Only "crew-b" carries a planned stop.
  const checkpoints = [
    { id: "start", latitude: route[0]!.latitude, longitude: route[0]!.longitude, distanceMetersFromStart: 0 },
    {
      id: "waypoint-a",
      title: "Overlook",
      latitude: route[10]!.latitude,
      longitude: route[10]!.longitude,
      distanceMetersFromStart: 1000,
      plannedStopSeconds: 0
    },
    {
      id: "crew-b",
      title: "Crew meetup",
      latitude: route[20]!.latitude,
      longitude: route[20]!.longitude,
      distanceMetersFromStart: 2000,
      plannedStopSeconds: 300
    },
    {
      id: "finish",
      latitude: route[40]!.latitude,
      longitude: route[40]!.longitude,
      distanceMetersFromStart: 4000
    }
  ];
  const { estimate } = estimatePacingMicroModelWithArtifacts({
    raceStartAt: "2026-08-01T06:00:00.000Z",
    checkpoints,
    history: [],
    routeMetricPoints: route,
    courseLengthMeters: 4000
  });
  const ids = estimate.aidEtas.map((eta) => eta.checkpointId);
  assert.deepEqual(ids, ["crew-b"]);
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
