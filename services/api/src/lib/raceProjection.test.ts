import test from "node:test";
import assert from "node:assert/strict";
import type { RaceCourse } from "@crewcue/contracts";
import {
  buildDerivedMetricsFromPolyline,
  checkpointsWithProjectedDistances,
  geodesicCumulativeAtVertices
} from "@crewcue/map-core";
import type { CourseMetricPoint } from "@crewcue/map-core";
import {
  cumulativeDistanceAtCheckpoints,
  polylineCourseLengthAndProgress,
  recomputeRaceProjection
} from "./raceProjection.js";

function withProjectedCheckpoints(course: RaceCourse): { course: RaceCourse; routeMetricPoints: CourseMetricPoint[] } {
  if (course.checkpoints.length < 2) {
    return { course, routeMetricPoints: [] };
  }
  const routeMetricPoints = course.checkpoints.map((c) => ({
    latitude: c.latitude,
    longitude: c.longitude
  }));
  const checkpoints = checkpointsWithProjectedDistances(course.checkpoints, routeMetricPoints);
  const derivedMetrics = buildDerivedMetricsFromPolyline(routeMetricPoints);
  return { course: { ...course, checkpoints, derivedMetrics }, routeMetricPoints };
}

test("polyline progress is near midpoint on straight two-segment course", () => {
  const base: RaceCourse = {
    checkpoints: [
      { id: "a", latitude: 41.0, longitude: -71.0 },
      { id: "b", latitude: 41.002, longitude: -71.0 },
      { id: "c", latitude: 41.004, longitude: -71.0 }
    ]
  };
  const { course, routeMetricPoints } = withProjectedCheckpoints(base);
  const { courseLengthMeters, progressMeters } = polylineCourseLengthAndProgress(
    course.checkpoints,
    41.001,
    -71.0
  );
  const cum = cumulativeDistanceAtCheckpoints(course.checkpoints);
  const expectedMid = cum[1]! / 2;
  assert.ok(Math.abs(progressMeters - expectedMid) < 3, `progress ${progressMeters} vs ${expectedMid}`);
  assert.ok(Math.abs(courseLengthMeters - cum[cum.length - 1]!) < 0.01);
  assert.ok(routeMetricPoints.length >= 2);
});

test("recompute is deterministic for fixed inputs", () => {
  const base: RaceCourse = {
    checkpoints: [
      { id: "a", latitude: 10.0, longitude: 20.0 },
      { id: "b", latitude: 10.01, longitude: 20.0 }
    ]
  };
  const { course, routeMetricPoints } = withProjectedCheckpoints(base);
  const activatedAt = "2026-04-16T12:00:00.000Z";
  const ping = {
    pingId: "ping-1",
    latitude: 10.005,
    longitude: 20.0,
    recordedAt: "2026-04-16T12:30:00.000Z"
  };
  const first = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt,
    course,
    plannedPaceSecondsPerKm: 600,
    ping,
    previous: null,
    routeMetricPoints
  });
  const second = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt,
    course,
    plannedPaceSecondsPerKm: 600,
    ping,
    previous: null,
    routeMetricPoints
  });
  assert.deepEqual(first.projection, second.projection);
  assert.ok(first.projection.weatherStub);
  assert.equal(first.projection.weatherStub?.source, "stub");
  assert.ok(typeof first.projection.weatherStub?.assumedHeadwindMps === "number");
});

test("baseline track drives planned splits and anchors ETA to the last crossed checkpoint", () => {
  const raw = [
    { id: "a", latitude: 10.0, longitude: 20.0 },
    { id: "b", latitude: 10.01, longitude: 20.0 },
    { id: "c", latitude: 10.02, longitude: 20.0 }
  ];
  const routeMetricPoints = raw.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  const checkpoints = checkpointsWithProjectedDistances(raw, routeMetricPoints);
  const cum = checkpoints.map((c) => c.distanceMetersFromStart!);
  const course: RaceCourse = {
    checkpoints,
    derivedMetrics: buildDerivedMetricsFromPolyline(routeMetricPoints),
    baselineTrack: {
      points: [
        { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
        { distanceMetersFromStart: cum[1]!, referenceElapsedSeconds: 300 },
        { distanceMetersFromStart: cum[2]!, referenceElapsedSeconds: 600 }
      ]
    }
  };
  const flatCourse: RaceCourse = { checkpoints: raw };
  const { course: flatWithArc, routeMetricPoints: flatRoute } = withProjectedCheckpoints(flatCourse);
  const activatedAt = "2026-04-16T12:00:00.000Z";
  const checkpointPing = {
    pingId: "ping-cp1",
    latitude: checkpoints[1]!.latitude,
    longitude: checkpoints[1]!.longitude,
    recordedAt: "2026-04-16T12:06:00.000Z"
  };
  const midSegmentPing = {
    pingId: "ping-mid",
    latitude: 10.015,
    longitude: 20.0,
    recordedAt: "2026-04-16T12:07:00.000Z"
  };

  const baselineCheckpoint = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt,
    course,
    plannedPaceSecondsPerKm: 600,
    ping: checkpointPing,
    previous: null,
    routeMetricPoints
  });
  const baselineMidSegment = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt,
    course,
    plannedPaceSecondsPerKm: 600,
    ping: midSegmentPing,
    previous: baselineCheckpoint.state,
    routeMetricPoints
  });
  const flatCheckpoint = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt,
    course: flatWithArc,
    plannedPaceSecondsPerKm: 600,
    ping: checkpointPing,
    previous: null,
    routeMetricPoints: flatRoute
  });
  const flatMidSegment = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt,
    course: flatWithArc,
    plannedPaceSecondsPerKm: 600,
    ping: midSegmentPing,
    previous: flatCheckpoint.state,
    routeMetricPoints: flatRoute
  });

  assert.equal(baselineMidSegment.projection.checkpointSplits[1]?.plannedElapsedSecondsAtCross, 300);
  assert.equal(baselineMidSegment.projection.checkpointSplits[2]?.plannedElapsedSecondsAtCross, 600);
  assert.equal(baselineMidSegment.projection.checkpointSplits[1]?.actualElapsedSecondsAtCross, 360);
  assert.equal(baselineMidSegment.projection.etaFinishPlanIso, "2026-04-16T12:11:00.000Z");
  assert.notEqual(flatMidSegment.projection.etaFinishPlanIso, baselineMidSegment.projection.etaFinishPlanIso);
  assert.ok(
    baselineMidSegment.projection.progressMeters > baselineCheckpoint.projection.progressMeters,
    "progress should still advance within the anchored segment"
  );
});

test("stoppage accumulates slowed intervals inside checkpoint radius", () => {
  const raw = [
    { id: "a", latitude: 10.0, longitude: 20.0, plannedStopSeconds: 120, stoppageRadiusMeters: 800 },
    { id: "b", latitude: 10.02, longitude: 20.0 }
  ];
  const { course, routeMetricPoints } = withProjectedCheckpoints({ checkpoints: raw });
  const activatedAt = "2026-04-16T12:00:00.000Z";
  const first = recomputeRaceProjection({
    roomId: "room-stop",
    activatedAt,
    course,
    plannedPaceSecondsPerKm: 300,
    ping: {
      pingId: "p1",
      latitude: 10.03,
      longitude: 20.0,
      recordedAt: "2026-04-16T12:01:00.000Z"
    },
    previous: null,
    routeMetricPoints
  });
  const second = recomputeRaceProjection({
    roomId: "room-stop",
    activatedAt,
    course,
    plannedPaceSecondsPerKm: 300,
    ping: {
      pingId: "p2",
      latitude: 10.005,
      longitude: 20.0,
      recordedAt: "2026-04-16T12:01:30.000Z"
    },
    previousPing: {
      pingId: "p1",
      latitude: 10.03,
      longitude: 20.0,
      recordedAt: "2026-04-16T12:01:00.000Z"
    },
    previous: first.state,
    routeMetricPoints
  });
  const third = recomputeRaceProjection({
    roomId: "room-stop",
    activatedAt,
    course,
    plannedPaceSecondsPerKm: 300,
    ping: {
      pingId: "p3",
      latitude: 10.00501,
      longitude: 20.0,
      recordedAt: "2026-04-16T12:02:00.000Z"
    },
    previousPing: {
      pingId: "p2",
      latitude: 10.005,
      longitude: 20.0,
      recordedAt: "2026-04-16T12:01:30.000Z"
    },
    previous: second.state,
    routeMetricPoints
  });
  const split = third.projection.checkpointSplits[0]!;
  assert.equal(split.plannedStopSeconds, 120);
  assert.equal(split.visits.length, 1);
  assert.ok((split.totalActualStopSeconds ?? 0) > 0);
  assert.ok(split.deltaStopSeconds !== null);
  assert.equal(third.projection.stoppageSummary.totalActualStopSeconds, 0);
});

/**
 * A point-to-point course: 1.5 km straight north, then a climb of twelve 300 m switchback legs
 * set 25 m apart. Neighbouring legs are close together but are not the same ground.
 */
function switchbackClimb(): { course: RaceCourse; routeMetricPoints: CourseMetricPoint[]; cumulative: number[] } {
  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos((42 * Math.PI) / 180);
  const at = (northMeters: number, eastMeters: number): CourseMetricPoint => ({
    latitude: 42 + northMeters / metersPerDegreeLatitude,
    longitude: -70 + eastMeters / metersPerDegreeLongitude
  });
  const routeMetricPoints: CourseMetricPoint[] = [at(0, 0), at(1500, 0)];
  for (let leg = 0; leg < 12; leg += 1) {
    const north = 1500 + leg * 25;
    routeMetricPoints.push(at(north, leg % 2 === 0 ? 300 : 0));
    routeMetricPoints.push(at(north + 25, leg % 2 === 0 ? 300 : 0));
  }
  const cumulative = geodesicCumulativeAtVertices(routeMetricPoints);
  const start = routeMetricPoints[0]!;
  const finish = routeMetricPoints[routeMetricPoints.length - 1]!;
  const checkpoints = checkpointsWithProjectedDistances(
    [
      { id: "start", latitude: start.latitude, longitude: start.longitude },
      { id: "finish", latitude: finish.latitude, longitude: finish.longitude }
    ],
    routeMetricPoints
  );
  return {
    course: { checkpoints, derivedMetrics: buildDerivedMetricsFromPolyline(routeMetricPoints) },
    routeMetricPoints,
    cumulative
  };
}

function pointAtProgress(route: CourseMetricPoint[], cumulative: number[], progressMeters: number): CourseMetricPoint {
  let i = 0;
  while (i < cumulative.length - 2 && cumulative[i + 1]! < progressMeters) {
    i += 1;
  }
  const t = (progressMeters - cumulative[i]!) / (cumulative[i + 1]! - cumulative[i]!);
  return {
    latitude: route[i]!.latitude + t * (route[i + 1]!.latitude - route[i]!.latitude),
    longitude: route[i]!.longitude + t * (route[i + 1]!.longitude - route[i]!.longitude)
  };
}

for (const gapSeconds of [30, 120, 360, 900]) {
  test(`switchback legs 25 m apart: a ${gapSeconds} s gap as the runner slows does not move them to a neighbouring leg`, () => {
    const { course, routeMetricPoints, cumulative } = switchbackClimb();
    const activatedAtMs = Date.parse("2026-06-01T12:00:00.000Z");
    // 3 m/s on the approach, 1 m/s on the climb; a fix every 30 s except one gap as the climb starts.
    const fixes: Array<{ seconds: number; progressMeters: number }> = [];
    let seconds = 0;
    let progress = 0;
    while (progress + 90 <= 1500) {
      seconds += 30;
      progress += 90;
      fixes.push({ seconds, progressMeters: progress });
    }
    seconds += gapSeconds;
    progress += gapSeconds;
    fixes.push({ seconds, progressMeters: progress });
    for (let i = 0; i < 40; i += 1) {
      seconds += 30;
      progress += 30;
      fixes.push({ seconds, progressMeters: progress });
    }

    let previous: Parameters<typeof recomputeRaceProjection>[0]["previous"] = null;
    let previousPing: Parameters<typeof recomputeRaceProjection>[0]["previousPing"] = null;
    let worstErrorMeters = 0;
    for (const [index, fix] of fixes.entries()) {
      const onRoute = pointAtProgress(routeMetricPoints, cumulative, fix.progressMeters);
      const ping = {
        pingId: `ping-${index}`,
        // GPS puts each fix 4 m north of the line.
        latitude: onRoute.latitude + 4 / 111_320,
        longitude: onRoute.longitude,
        recordedAt: new Date(activatedAtMs + fix.seconds * 1000).toISOString()
      };
      const next = recomputeRaceProjection({
        roomId: "switchbacks",
        activatedAt: new Date(activatedAtMs).toISOString(),
        course,
        plannedPaceSecondsPerKm: 480,
        ping,
        previousPing,
        previous,
        routeMetricPoints
      });
      worstErrorMeters = Math.max(worstErrorMeters, Math.abs(next.projection.progressMeters - fix.progressMeters));
      previous = next.state;
      previousPing = ping;
    }
    assert.ok(worstErrorMeters < 30, `worst progress error ${Math.round(worstErrorMeters)} m`);
  });
}

test("out-and-back: after a ten-minute stop near the turnaround the runner is followed home, not back down the outbound leg", () => {
  // 3 km north and back along the same line.
  const out: CourseMetricPoint[] = Array.from({ length: 31 }, (_, i) => ({
    latitude: 42 + (i * 100) / 111_320,
    longitude: -70
  }));
  const routeMetricPoints = [...out, ...out.slice(0, -1).reverse()];
  const cumulative = geodesicCumulativeAtVertices(routeMetricPoints);
  const length = cumulative[cumulative.length - 1]!;
  const checkpoints = checkpointsWithProjectedDistances(
    [
      { id: "start", latitude: 42, longitude: -70 },
      { id: "finish", latitude: 42, longitude: -70 }
    ],
    routeMetricPoints
  );
  const course: RaceCourse = { checkpoints, derivedMetrics: buildDerivedMetricsFromPolyline(routeMetricPoints) };

  // 100 m a minute out to 150 m short of the turnaround, ten minutes stopped there, then home
  // at the same pace. The stop takes the rolling speed down to almost nothing.
  const stopAt = length / 2 - 150;
  const truth: number[] = [];
  for (let p = 50; p < stopAt; p += 100) truth.push(p);
  for (let i = 0; i < 10; i += 1) truth.push(stopAt);
  for (let p = stopAt + 100; p < length; p += 100) truth.push(p);

  const activatedAtMs = Date.parse("2026-06-01T12:00:00.000Z");
  let previous: Parameters<typeof recomputeRaceProjection>[0]["previous"] = null;
  let previousPing: Parameters<typeof recomputeRaceProjection>[0]["previousPing"] = null;
  let worstErrorOnTheWayHome = 0;
  for (const [index, progressMeters] of truth.entries()) {
    const onRoute = pointAtProgress(routeMetricPoints, cumulative, progressMeters);
    const ping = {
      pingId: `ping-${index}`,
      latitude: onRoute.latitude,
      longitude: onRoute.longitude + (index % 2 === 0 ? 0.00003 : -0.00003),
      recordedAt: new Date(activatedAtMs + (index + 1) * 60_000).toISOString()
    };
    const next = recomputeRaceProjection({
      roomId: "out-and-back",
      activatedAt: new Date(activatedAtMs).toISOString(),
      course,
      plannedPaceSecondsPerKm: 480,
      ping,
      previousPing,
      previous,
      routeMetricPoints
    });
    if (progressMeters > length / 2 + 200) {
      worstErrorOnTheWayHome = Math.max(
        worstErrorOnTheWayHome,
        Math.abs(next.projection.progressMeters - progressMeters)
      );
    }
    previous = next.state;
    previousPing = ping;
  }
  assert.ok(worstErrorOnTheWayHome < 30, `worst progress error on the way home ${Math.round(worstErrorOnTheWayHome)} m`);
});
