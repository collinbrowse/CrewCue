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

test("does not force mile zero when first checkpoint is not the route start", () => {
  const routeWithoutStartCheckpoint = [
    { latitude: 40.0, longitude: -105.0 },
    { latitude: 40.0, longitude: -104.96 },
    { latitude: 40.0, longitude: -104.92 },
    { latitude: 40.0, longitude: -104.88 }
  ];
  const projected = checkpointsWithProjectedDistances(
    [
      { id: "aid-1", latitude: 40.0, longitude: -104.96, distanceMetersFromStart: 3400 },
      { id: "aid-2", latitude: 40.0, longitude: -104.92, distanceMetersFromStart: 6800 }
    ],
    routeWithoutStartCheckpoint
  );
  const firstDistance = projected[0]!.distanceMetersFromStart ?? 0;
  assert.ok(firstDistance > 2000, `first aid station should keep its route mile, got ${firstDistance}`);
  assert.ok((projected[1]!.distanceMetersFromStart ?? 0) > firstDistance);
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
