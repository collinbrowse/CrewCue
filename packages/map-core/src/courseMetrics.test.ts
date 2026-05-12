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
