import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDerivedMetricsFromPolyline,
  buildPlanBaselineFromModel,
  checkpointsWithProjectedDistances,
  gainLossFromSmoothed,
  geodesicCumulativeAtVertices,
  geodesicPolylineLength,
  geodesicProjectPointToPolyline,
  smoothElevations
} from "./courseMetrics.js";

const route = [
  { latitude: 40, longitude: -105, elevationMeters: 1000 },
  { latitude: 40.01, longitude: -105, elevationMeters: 1040 },
  { latitude: 40.02, longitude: -105, elevationMeters: 1020 },
  { latitude: 40.03, longitude: -105, elevationMeters: 1080 }
];

test("geodesic length and cumulative distances are monotonic", () => {
  const cumulative = geodesicCumulativeAtVertices(route);
  const total = geodesicPolylineLength(route);
  assert.equal(cumulative.length, route.length);
  assert.ok(total > 3000);
  assert.equal(cumulative[0], 0);
  assert.equal(cumulative[cumulative.length - 1], total);
  assert.ok(cumulative.every((value, index) => index === 0 || value > cumulative[index - 1]!));
});

test("projects checkpoints onto route arc length", () => {
  const projected = geodesicProjectPointToPolyline(route, { latitude: 40.015, longitude: -105.001 });
  assert.ok(projected.courseLengthMeters > 3000);
  assert.ok(projected.progressMeters > 1000);
  assert.ok(projected.progressMeters < projected.courseLengthMeters);

  const checkpoints = checkpointsWithProjectedDistances(
    [
      { id: "start", latitude: 40, longitude: -105 },
      { id: "mid", latitude: 40.015, longitude: -105 },
      { id: "finish", latitude: 40.03, longitude: -105 }
    ],
    route
  );
  assert.equal(checkpoints[0]?.distanceMetersFromStart, 0);
  assert.ok((checkpoints[1]?.distanceMetersFromStart ?? 0) > 0);
  assert.ok((checkpoints[2]?.distanceMetersFromStart ?? 0) > (checkpoints[1]?.distanceMetersFromStart ?? 0));
});

test("sequential projection assigns distinct arc positions for two checkpoints at identical coordinates on a loop", () => {
  const loopRoute = [
    { latitude: 40.0, longitude: -105.0 },
    { latitude: 40.0, longitude: -104.92 },
    { latitude: 40.0, longitude: -104.84 },
    { latitude: 40.0, longitude: -104.92 },
    { latitude: 40.0, longitude: -105.0 }
  ];
  const sharedAid = { latitude: 40.0, longitude: -104.92 };
  const projected = checkpointsWithProjectedDistances(
    [
      { id: "start", latitude: 40.0, longitude: -105.0 },
      { id: "aid-first", ...sharedAid },
      { id: "aid-second", ...sharedAid },
      { id: "finish", latitude: 40.0, longitude: -105.0 }
    ],
    loopRoute
  );
  const d0 = projected[0]!.distanceMetersFromStart!;
  const d1 = projected[1]!.distanceMetersFromStart!;
  const d2 = projected[2]!.distanceMetersFromStart!;
  const d3 = projected[3]!.distanceMetersFromStart!;
  const total = geodesicPolylineLength(loopRoute);
  assert.ok(d0 <= d1);
  assert.ok(d1 < d2);
  assert.ok(d2 < d3);
  assert.ok(Math.abs(d3 - total) < 0.5, "loop finish should anchor at full course length");
  assert.ok(d2 - d1 > 500, "second visit should be materially farther along the course than the first");
});

test("first checkpoint is mile zero and loop finish anchors at course length when start and finish coincide", () => {
  const loopRoute = [
    { latitude: 40.0, longitude: -105.0 },
    { latitude: 40.0, longitude: -104.92 },
    { latitude: 40.0, longitude: -104.84 },
    { latitude: 40.0, longitude: -104.92 },
    { latitude: 40.0, longitude: -105.0 }
  ];
  const total = geodesicPolylineLength(loopRoute);
  const startFinish = { latitude: 40.0, longitude: -105.0 };
  const projected = checkpointsWithProjectedDistances(
    [
      { id: "town-park-start-finish", ...startFinish },
      { id: "mid-aid", latitude: 40.0, longitude: -104.88 },
      { id: "town-park-start-finish-2", ...startFinish }
    ],
    loopRoute
  );
  assert.equal(projected[0]!.distanceMetersFromStart, 0);
  assert.ok((projected[1]!.distanceMetersFromStart ?? 0) > 800);
  assert.ok(Math.abs((projected[2]!.distanceMetersFromStart ?? 0) - total) < 0.5);
});

test("repeated non-start aid checkpoints are not rewritten as course start and finish", () => {
  const loopRoute = [
    { latitude: 40.0, longitude: -105.0 },
    { latitude: 40.0, longitude: -104.92 },
    { latitude: 40.0, longitude: -104.84 },
    { latitude: 40.0, longitude: -104.92 },
    { latitude: 40.0, longitude: -105.0 }
  ];
  const total = geodesicPolylineLength(loopRoute);
  const sharedAid = { latitude: 40.0, longitude: -104.92 };
  const projected = checkpointsWithProjectedDistances(
    [
      { id: "aid-first", ...sharedAid },
      { id: "aid-second", ...sharedAid }
    ],
    loopRoute
  );

  const firstAid = projected[0]!.distanceMetersFromStart!;
  const secondAid = projected[1]!.distanceMetersFromStart!;
  assert.ok(firstAid > 500, `first aid should retain its route mile, got ${firstAid}`);
  assert.ok(secondAid > firstAid + 500, `second aid should be after first aid, got ${firstAid} -> ${secondAid}`);
  assert.ok(secondAid < total - 500, `second aid should not be clamped to finish, got ${secondAid} of ${total}`);
});

test("checkpoint encounter hint disambiguates repeated route coordinates", () => {
  const outAndBack = [
    { latitude: 40.0, longitude: -105.0 },
    { latitude: 40.0, longitude: -104.96 },
    { latitude: 40.0, longitude: -104.92 },
    { latitude: 40.0, longitude: -104.96 },
    { latitude: 40.0, longitude: -105.0 }
  ];
  const cumulative = geodesicCumulativeAtVertices(outAndBack);
  const firstVisitMeters = cumulative[1]!;
  const secondVisitMeters = cumulative[3]!;

  const [projected] = checkpointsWithProjectedDistances(
    [{ id: "shared-aid-second-pass", latitude: 40.0, longitude: -104.96, distanceMetersFromStart: secondVisitMeters }],
    outAndBack
  );

  assert.ok(
    projected!.distanceMetersFromStart! > firstVisitMeters + 500,
    `encounter hint should skip first pass at ${firstVisitMeters}, got ${projected!.distanceMetersFromStart}`
  );
  assert.ok(
    Math.abs(projected!.distanceMetersFromStart! - secondVisitMeters) < 0.5,
    `expected second-pass distance ${secondVisitMeters}, got ${projected!.distanceMetersFromStart}`
  );
});

test("checkpoint encounter hint wins when geodesic snap diverges by kilometers", () => {
  const routeWithDistantSnap = [
    { latitude: 40.0, longitude: -105.0 },
    { latitude: 40.02, longitude: -105.0 },
    { latitude: 40.04, longitude: -105.0 },
    { latitude: 40.06, longitude: -105.0 },
    { latitude: 40.08, longitude: -105.0 }
  ];
  const importEncounterMeters = 2500;

  const [projected] = checkpointsWithProjectedDistances(
    [
      {
        id: "aid-with-haversine-encounter-distance",
        latitude: 40.06,
        longitude: -105.0,
        distanceMetersFromStart: importEncounterMeters
      }
    ],
    routeWithDistantSnap
  );

  assert.equal(projected!.distanceMetersFromStart, importEncounterMeters);
});

test("smoothed elevation computes gain and loss", () => {
  const smoothed = smoothElevations(route, { windowSize: 1 });
  const vertical = gainLossFromSmoothed(smoothed, { minimumDeltaMeters: 1 });
  assert.equal(vertical.elevationGainMeters, 100);
  assert.equal(vertical.elevationLossMeters, 20);
  const metrics = buildDerivedMetricsFromPolyline(route);
  assert.equal(metrics.metricsVersion, 1);
  assert.equal(metrics.elevationSource, "gpx_smoothed");
  assert.ok(metrics.canonicalDistanceMeters > 3000);
});

test("model baseline is strictly increasing for non-trivial routes", () => {
  const baseline = buildPlanBaselineFromModel(route, 360);
  assert.ok(baseline);
  const points = baseline!.points;
  assert.equal(points[0]?.referenceElapsedSeconds, 0);
  assert.ok(points[points.length - 1]!.referenceElapsedSeconds > 0);
  assert.ok(
    points.every(
      (point, index) =>
        index === 0 ||
        (point.distanceMetersFromStart > points[index - 1]!.distanceMetersFromStart &&
          point.referenceElapsedSeconds > points[index - 1]!.referenceElapsedSeconds)
    )
  );
  assert.ok(points.some((point) => typeof point.elevationMeters === "number"));
});

/**
 * Pins the fallback climb penalty to one hour per 1000 m of gain. The previous 8 s/m default survived
 * unnoticed because the only baseline coverage asserted monotonicity, which any positive penalty satisfies.
 * Uses a monotonic climb so the descent credit is zero and the penalty is the sole non-horizontal term.
 */
test("fallback baseline charges 3.6 seconds per meter of climb", () => {
  const climb = [
    { latitude: 40, longitude: -105, elevationMeters: 1000 },
    { latitude: 40.01, longitude: -105, elevationMeters: 1040 },
    { latitude: 40.02, longitude: -105, elevationMeters: 1080 },
    { latitude: 40.03, longitude: -105, elevationMeters: 1120 },
    { latitude: 40.04, longitude: -105, elevationMeters: 1160 }
  ];
  const paceSecondsPerKm = 360;

  const finishElapsed = (track: ReturnType<typeof buildPlanBaselineFromModel>): number => {
    const points = track!.points;
    return points[points.length - 1]!.referenceElapsedSeconds;
  };

  // Recompute the expected total from the smoothed profile the builder itself uses.
  const smoothed = smoothElevations(climb);
  let smoothedGainMeters = 0;
  for (let index = 1; index < smoothed.length; index += 1) {
    const delta = smoothed[index]!.elevationMeters - smoothed[index - 1]!.elevationMeters;
    if (delta > 0) {
      smoothedGainMeters += delta;
    }
  }
  assert.ok(smoothedGainMeters > 0, "climb fixture should register positive smoothed gain");

  const horizontalSeconds = (geodesicPolylineLength(climb) / 1000) * paceSecondsPerKm;
  const expected = horizontalSeconds + smoothedGainMeters * 3.6;
  const actual = finishElapsed(buildPlanBaselineFromModel(climb, paceSecondsPerKm));
  assert.ok(
    Math.abs(actual - expected) < 1,
    `expected ~${expected.toFixed(1)}s at 3.6 s/m, got ${actual.toFixed(1)}s`
  );

  // The default must stay 3.6, and the retired 8 s/m value must remain clearly slower.
  assert.equal(actual, finishElapsed(buildPlanBaselineFromModel(climb, paceSecondsPerKm, { gainPenaltySecondsPerMeter: 3.6 })));
  assert.ok(finishElapsed(buildPlanBaselineFromModel(climb, paceSecondsPerKm, { gainPenaltySecondsPerMeter: 8 })) > actual);
});
