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
  finishCheckpointIndex,
  isMarkedFinish,
  nextVisitIndex,
  type FinishCandidate,
  polylineCourseLengthAndProgress,
  recomputeRaceProjection,
  routeEndFinishRowId
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

test("out-and-back: a stop at the aid station on the way out is not logged on its return-leg checkpoint", () => {
  // 3 km north and back along the same line. One aid station at 1 km, passed on the way out
  // (aid-out, ~1 km) and again on the way back (aid-back, ~5 km): two checkpoints, same spot.
  const out: CourseMetricPoint[] = Array.from({ length: 31 }, (_, i) => ({
    latitude: 42 + (i * 100) / 111_320,
    longitude: -70
  }));
  const routeMetricPoints = [...out, ...out.slice(0, -1).reverse()];
  const cumulative = geodesicCumulativeAtVertices(routeMetricPoints);
  const aid = out[10]!;
  const checkpoints = checkpointsWithProjectedDistances(
    [
      { id: "start", latitude: 42, longitude: -70 },
      { id: "aid-out", latitude: aid.latitude, longitude: aid.longitude, plannedStopSeconds: 300 },
      { id: "turnaround", latitude: out[30]!.latitude, longitude: out[30]!.longitude },
      { id: "aid-back", latitude: aid.latitude, longitude: aid.longitude, plannedStopSeconds: 300 },
      { id: "finish", latitude: 42, longitude: -70 }
    ],
    routeMetricPoints
  );
  const aidBackAt = checkpoints.find((c) => c.id === "aid-back")!.distanceMetersFromStart!;
  assert.ok(aidBackAt > 4_500, `aid-back sits on the return leg (${Math.round(aidBackAt)} m)`);
  const course: RaceCourse = { checkpoints, derivedMetrics: buildDerivedMetricsFromPolyline(routeMetricPoints) };

  // 100 m a minute out to the aid station, six minutes stopped there, then on to 2 km.
  const truth: number[] = [];
  for (let p = 100; p < 1_000; p += 100) truth.push(p);
  for (let i = 0; i < 6; i += 1) truth.push(1_000);
  for (let p = 1_100; p <= 2_000; p += 100) truth.push(p);

  const activatedAtMs = Date.parse("2026-06-01T12:00:00.000Z");
  let previous: Parameters<typeof recomputeRaceProjection>[0]["previous"] = null;
  let previousPing: Parameters<typeof recomputeRaceProjection>[0]["previousPing"] = null;
  let last: ReturnType<typeof recomputeRaceProjection> | undefined;
  for (const [index, progressMeters] of truth.entries()) {
    const onRoute = pointAtProgress(routeMetricPoints, cumulative, progressMeters);
    const ping = {
      pingId: `ping-${index}`,
      latitude: onRoute.latitude,
      longitude: onRoute.longitude,
      recordedAt: new Date(activatedAtMs + (index + 1) * 60_000).toISOString()
    };
    last = recomputeRaceProjection({
      roomId: "out-and-back-aid",
      activatedAt: new Date(activatedAtMs).toISOString(),
      course,
      plannedPaceSecondsPerKm: 480,
      ping,
      previousPing,
      previous,
      routeMetricPoints
    });
    previous = last.state;
    previousPing = ping;
  }
  const projection = last!.projection;
  assert.ok(projection.progressMeters < 2_100, `runner is on the way out (${Math.round(projection.progressMeters)} m)`);
  const row = (id: string) => projection.checkpointSplits.find((r) => r.checkpointId === id)!;
  assert.equal(row("aid-out").visits.length, 1, "the stop is logged at the aid station on the way out");
  assert.ok((row("aid-out").totalActualStopSeconds ?? 0) >= 240, "the outbound stop time is on aid-out");
  assert.deepEqual(row("aid-back").visits, [], "the return-leg checkpoint 3 km ahead has no visit yet");
  assert.equal(row("aid-back").totalActualStopSeconds, null);
  assert.equal(
    projection.stoppageSummary.remainingPlannedStopSeconds,
    300,
    "the planned stop on the way back is still ahead of the runner"
  );
  assert.equal(
    projection.stoppageSummary.totalActualStopSeconds,
    row("aid-out").totalActualStopSeconds,
    "the outbound stop is counted once"
  );
});

test("out-and-back: a stop at the finish line is logged on the finish, not on the start checkpoint at the same spot", () => {
  // 3 km north and back, finishing where it started: start and finish are two checkpoints, same spot.
  const out: CourseMetricPoint[] = Array.from({ length: 31 }, (_, i) => ({
    latitude: 42 + (i * 100) / 111_320,
    longitude: -70
  }));
  const routeMetricPoints = [...out, ...out.slice(0, -1).reverse()];
  const cumulative = geodesicCumulativeAtVertices(routeMetricPoints);
  const checkpoints = checkpointsWithProjectedDistances(
    [
      { id: "start", latitude: 42, longitude: -70 },
      { id: "turnaround", latitude: out[30]!.latitude, longitude: out[30]!.longitude },
      { id: "finish", latitude: 42, longitude: -70, plannedStopSeconds: 300 }
    ],
    routeMetricPoints
  );
  const course: RaceCourse = { checkpoints, derivedMetrics: buildDerivedMetricsFromPolyline(routeMetricPoints) };

  // The first ping is already past the start line's radius, so the start never gets a visit on
  // the way out. 100 m a minute to the finish, then six minutes stopped on the line.
  const truth: number[] = [];
  for (let p = 200; p < 6_000; p += 100) truth.push(p);
  for (let i = 0; i < 6; i += 1) truth.push(6_000);

  const activatedAtMs = Date.parse("2026-06-01T12:00:00.000Z");
  let previous: Parameters<typeof recomputeRaceProjection>[0]["previous"] = null;
  let previousPing: Parameters<typeof recomputeRaceProjection>[0]["previousPing"] = null;
  let last: ReturnType<typeof recomputeRaceProjection> | undefined;
  for (const [index, progressMeters] of truth.entries()) {
    const onRoute = pointAtProgress(routeMetricPoints, cumulative, progressMeters);
    const ping = {
      pingId: `ping-${index}`,
      latitude: onRoute.latitude,
      longitude: onRoute.longitude,
      recordedAt: new Date(activatedAtMs + (index + 1) * 60_000).toISOString()
    };
    last = recomputeRaceProjection({
      roomId: "out-and-back-finish",
      activatedAt: new Date(activatedAtMs).toISOString(),
      course,
      plannedPaceSecondsPerKm: 480,
      ping,
      previousPing,
      previous,
      routeMetricPoints
    });
    previous = last.state;
    previousPing = ping;
  }
  const projection = last!.projection;
  assert.ok(projection.progressMeters > 5_800, `runner is at the finish (${Math.round(projection.progressMeters)} m)`);
  const row = (id: string) => projection.checkpointSplits.find((r) => r.checkpointId === id)!;
  assert.deepEqual(row("start").visits, [], "the finish-line stop is not logged on the start checkpoint");
  assert.equal(row("start").totalActualStopSeconds, null);
  assert.equal(row("finish").visits.length, 1, "the finish-line stop is logged on the finish");
  assert.ok((row("finish").totalActualStopSeconds ?? 0) >= 240, "the stop time is on the finish");
  assert.equal(projection.stoppageSummary.remainingPlannedStopSeconds, 0, "the finish stop is no longer ahead");
});

/** A ~2.2 km three-checkpoint course with planned stops, flat (no plan curve) or with a 600 s curve. */
function stopsCourse(stops: { a: number; b: number; c: number }, withCurve: boolean) {
  const raw = [
    { id: "a", latitude: 10.0, longitude: 20.0, plannedStopSeconds: stops.a },
    { id: "b", latitude: 10.01, longitude: 20.0, plannedStopSeconds: stops.b },
    { id: "c", latitude: 10.02, longitude: 20.0, plannedStopSeconds: stops.c }
  ];
  const routeMetricPoints = raw.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  const checkpoints = checkpointsWithProjectedDistances(raw, routeMetricPoints);
  const length = checkpoints[2]!.distanceMetersFromStart!;
  const course: RaceCourse = {
    checkpoints,
    derivedMetrics: buildDerivedMetricsFromPolyline(routeMetricPoints),
    ...(withCurve
      ? {
          baselineTrack: {
            points: [
              { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
              { distanceMetersFromStart: length, referenceElapsedSeconds: 600 }
            ]
          }
        }
      : {})
  };
  return { course, routeMetricPoints, length };
}

function withTunedConstants<T>(on: boolean, run: () => T): T {
  const before = process.env.PROJECTION_TUNED_CONSTANTS;
  if (on) {
    process.env.PROJECTION_TUNED_CONSTANTS = "1";
  } else {
    delete process.env.PROJECTION_TUNED_CONSTANTS;
  }
  try {
    return run();
  } finally {
    if (before === undefined) {
      delete process.env.PROJECTION_TUNED_CONSTANTS;
    } else {
      process.env.PROJECTION_TUNED_CONSTANTS = before;
    }
  }
}

const START_AT = "2026-04-16T12:00:00.000Z";
const startMs = Date.parse(START_AT);
const at = (seconds: number) => new Date(startMs + seconds * 1000).toISOString();
const finishSeconds = (iso: string) => (Date.parse(iso) - startMs) / 1000;

test("finish ETA is the arrival at the finish line: the finish checkpoint's own planned stop is never added", () => {
  for (const tuned of [false, true]) {
    for (const withCurve of [false, true]) {
      const label = `${tuned ? "tuned" : "today"}, ${withCurve ? "plan curve" : "plan pace"}`;
      const finishAt = (finishStop: number) =>
        withTunedConstants(tuned, () => {
          const { course, routeMetricPoints } = stopsCourse({ a: 60, b: 120, c: finishStop }, withCurve);
          return recomputeRaceProjection({
            roomId: "room-1",
            activatedAt: START_AT,
            course,
            plannedPaceSecondsPerKm: 600,
            ping: { pingId: "at-start", latitude: 10.0, longitude: 20.0, recordedAt: START_AT },
            previous: null,
            routeMetricPoints
          }).projection.etaFinishPlanIso;
        });
      assert.equal(finishAt(600), finishAt(0), `${label}: the finish's stop does not move the finish`);
      if (!tuned) {
        const { length } = stopsCourse({ a: 0, b: 0, c: 0 }, withCurve);
        const moving = withCurve ? 600 : (length / 1000) * 600;
        // The plan plus the stops on the way (a and b), not the finish's.
        assert.ok(Math.abs(finishSeconds(finishAt(600)) - (moving + 180)) < 0.01, `${label}: ${finishAt(600)}`);
      }
    }
  }
});

test("standing at the finish, its planned stop still running, the finish ETA is not pushed back by it", () => {
  const { course, routeMetricPoints } = stopsCourse({ a: 0, b: 0, c: 600 }, true);
  const finish = course.checkpoints[2]!;
  const startPing = { pingId: "p0", latitude: 10.0, longitude: 20.0, recordedAt: START_AT };
  const first = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt: START_AT,
    course,
    plannedPaceSecondsPerKm: 600,
    ping: startPing,
    previous: null,
    routeMetricPoints
  });
  const arrive = { pingId: "p1", latitude: finish.latitude, longitude: finish.longitude, recordedAt: at(600) };
  const arrived = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt: START_AT,
    course,
    plannedPaceSecondsPerKm: 600,
    ping: arrive,
    previousPing: startPing,
    previous: first.state,
    routeMetricPoints
  });
  // Still at the finish a minute later: a stop there is in progress (60 s of its 600 s).
  const stopped = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt: START_AT,
    course,
    plannedPaceSecondsPerKm: 600,
    ping: { ...arrive, pingId: "p2", recordedAt: at(660) },
    previousPing: arrive,
    previous: arrived.state,
    routeMetricPoints
  });
  const visit = stopped.projection.checkpointSplits[2]!.visits[0]!;
  assert.ok(visit.autoDetected?.firstSlowedAt && !visit.autoDetected.departureRecordedAt, "a stop at the finish is in progress");
  // Finished at 600 s; the ETA is never before the ping (660 s), and the 540 s left of the
  // finish's planned stop is after the finish line.
  assert.equal(stopped.projection.etaFinishPlanIso, at(660));
});

test("a projection taken before the start counts the rest of the course from the start, not from then", () => {
  for (const withCurve of [false, true]) {
    const { course, routeMetricPoints, length } = stopsCourse({ a: 60, b: 120, c: 600 }, withCurve);
    const moving = withCurve ? 600 : (length / 1000) * 600;
    const atStartLine = (recordedAt: string) =>
      withTunedConstants(false, () =>
        recomputeRaceProjection({
          roomId: "room-1",
          activatedAt: START_AT,
          course,
          plannedPaceSecondsPerKm: 600,
          // The pre-race bootstrap: a synthetic ping at the first checkpoint, taken now.
          ping: { pingId: "bootstrap", latitude: 10.0, longitude: 20.0, recordedAt },
          previous: null,
          routeMetricPoints
        }).projection.etaFinishPlanIso
      );
    const label = withCurve ? "plan curve" : "plan pace";
    // Three days before the start: the start plus the plan, never then plus the plan.
    assert.ok(Math.abs(finishSeconds(atStartLine(at(-3 * 24 * 3600))) - (moving + 180)) < 0.01, `${label}: pre-race`);
    // Ten minutes after the start, still at the start line: the plan curve's finish is anchored
    // at the start crossing; plan pace counts from then, as before.
    const late = withCurve ? moving + 180 : 600 + moving + 180;
    assert.ok(Math.abs(finishSeconds(atStartLine(at(600))) - late) < 0.01, `${label}: after the start`);
  }
});

/** Checkpoints at `distances`, named `cp-0`, `cp-1`, ... (none of them marked the finish). */
const atDistances = (distances: Array<number | undefined>): FinishCandidate[] =>
  distances.map((distance, index) => ({ id: `cp-${index}`, ...(distance !== undefined ? { distanceMetersFromStart: distance } : {}) }));

test("the finish checkpoint is the farthest one only at the course's end", () => {
  assert.equal(finishCheckpointIndex(atDistances([0, 10_000, 40_000]), 40_000), 2);
  assert.equal(finishCheckpointIndex(atDistances([0, 40_000, 10_000]), 40_000), 1, "farthest, not last listed");
  assert.equal(finishCheckpointIndex(atDistances([0, 40_000, 40_000]), 40_000), 2, "a tie keeps the later row");
  assert.equal(finishCheckpointIndex(atDistances([0, 10_000, 39_700]), 40_000), 2, "within 1% of the course length");
  assert.equal(finishCheckpointIndex(atDistances([0, 10_000, 40_200]), 40_000), 2, "past it");
  assert.equal(finishCheckpointIndex(atDistances([0, 10_000, 30_000]), 40_000), -1, "a last aid short of the route's end");
  assert.equal(finishCheckpointIndex(atDistances([0, 4_920]), 5_000), 1, "100 m beats 1% of 5 km");
  assert.equal(finishCheckpointIndex(atDistances([0, 4_890]), 5_000), -1);
  assert.equal(finishCheckpointIndex(atDistances([0]), 5_000), -1, "the start alone has no finish");
  assert.equal(finishCheckpointIndex(atDistances([0, undefined, 40_000]), 40_000), -1, "a distance unknown: no finish known");
});

test("the farthest checkpoint marked as the finish is the finish, however far short of the route's end", () => {
  // A finish waypoint 1.5% short of where the route ends (past the 1% tolerance).
  const short = (marks: Partial<FinishCandidate>): FinishCandidate[] => [
    { id: "start", distanceMetersFromStart: 0 },
    { id: "aid-1", distanceMetersFromStart: 20_000 },
    { id: "last", distanceMetersFromStart: 39_400, ...marks }
  ];
  assert.equal(finishCheckpointIndex(short({}), 40_000), -1, "unmarked, it is an aid short of the end");
  for (const marks of [
    { id: "finish" },
    { id: "FINISH" },
    { title: "Finish" },
    { title: " finish " },
    { tags: ["aid", "Finish"] as unknown as FinishCandidate["tags"] }
  ]) {
    assert.equal(finishCheckpointIndex(short(marks), 40_000), 2, JSON.stringify(marks));
    assert.equal(isMarkedFinish({ ...short(marks)[2]! }), true, JSON.stringify(marks));
  }
  assert.equal(isMarkedFinish({ id: "finish-line" }), false, "the word alone, not a name containing it");
  assert.equal(isMarkedFinish({ id: "aid-3", title: "Finish Line" }), false);
  // Only the farthest is read: an earlier `finish` is a loop's first pass, not the end.
  assert.equal(
    finishCheckpointIndex([{ id: "start", distanceMetersFromStart: 0 }, { id: "finish", distanceMetersFromStart: 20_000 }, { id: "aid-9", distanceMetersFromStart: 30_000 }], 40_000),
    -1
  );
});

/** Three checkpoints with planned stops on a route that runs on as far again past the last (no finish waypoint). */
function shortCheckpointsCourse(lastStopSeconds: number, withCurve: boolean) {
  const raw = [
    { id: "a", latitude: 10.0, longitude: 20.0, plannedStopSeconds: 60 },
    { id: "b", latitude: 10.01, longitude: 20.0, plannedStopSeconds: 120 },
    { id: "c", latitude: 10.02, longitude: 20.0, plannedStopSeconds: lastStopSeconds }
  ];
  const routeMetricPoints = [
    ...raw.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    { latitude: 10.04, longitude: 20.0 }
  ];
  const derivedMetrics = buildDerivedMetricsFromPolyline(routeMetricPoints);
  const length = derivedMetrics.canonicalDistanceMeters;
  const course: RaceCourse = {
    checkpoints: checkpointsWithProjectedDistances(raw, routeMetricPoints),
    derivedMetrics,
    ...(withCurve
      ? {
          baselineTrack: {
            points: [
              { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
              { distanceMetersFromStart: length, referenceElapsedSeconds: 1200 }
            ]
          }
        }
      : {})
  };
  return { course, routeMetricPoints, length };
}

test("checkpoints that stop short of the route's end: every planned stop counts toward the finish, the last one's too", () => {
  for (const withCurve of [false, true]) {
    const label = withCurve ? "plan curve" : "plan pace";
    const startPing = { pingId: "p0", latitude: 10.0, longitude: 20.0, recordedAt: START_AT };
    const atC = { pingId: "p1", latitude: 10.02, longitude: 20.0, recordedAt: at(600) };
    const stillAtC = { ...atC, pingId: "p2", recordedAt: at(660) };
    const race = (lastStopSeconds: number) =>
      withTunedConstants(false, () => {
        const { course, routeMetricPoints, length } = shortCheckpointsCourse(lastStopSeconds, withCurve);
        const project = (
          ping: typeof startPing,
          previousPing: typeof startPing | null,
          previous: ReturnType<typeof recomputeRaceProjection>["state"] | null
        ) =>
          recomputeRaceProjection({
            roomId: "room-1",
            activatedAt: START_AT,
            course,
            plannedPaceSecondsPerKm: 600,
            ping,
            previousPing,
            previous,
            routeMetricPoints
          });
        const first = project(startPing, null, null);
        const arrived = project(atC, startPing, first.state);
        const stopped = project(stillAtC, atC, arrived.state);
        return { length, first: first.projection, stopped: stopped.projection };
      });

    const { length, first, stopped } = race(600);
    const moving = withCurve ? 1200 : (length / 1000) * 600;
    assert.ok(
      Math.abs(finishSeconds(first.etaFinishPlanIso) - (moving + 60 + 120 + 600)) < 0.01,
      `${label}: the plan plus all three stops, ${first.etaFinishPlanIso}`
    );
    const visit = stopped.checkpointSplits[2]!.visits[0]!;
    assert.ok(visit.autoDetected?.firstSlowedAt && !visit.autoDetected.departureRecordedAt, `${label}: a stop at c is in progress`);
    // A minute into c's 600 s stop: the 540 s left of it is still ahead of the finish line.
    const shortStop = race(60).stopped;
    assert.ok(
      Math.abs(finishSeconds(stopped.etaFinishPlanIso) - finishSeconds(shortStop.etaFinishPlanIso) - 540) < 0.01,
      `${label}: ${stopped.etaFinishPlanIso} vs ${shortStop.etaFinishPlanIso}`
    );
  }
});

test("an aid station passed between two pings no longer adds its planned stop to the finish ETA", () => {
  for (const tuned of [false, true]) {
    for (const withCurve of [false, true]) {
      const label = `${tuned ? "tuned" : "today"}, ${withCurve ? "plan curve" : "plan pace"}`;
      // Start at a, b ~1.1 km on, finish c ~2.2 km. Pings every few minutes land ~0.6 km before
      // and ~0.6 km after b: never inside its 150 m radius, so b gets no visit.
      const race = (bStopSeconds: number) =>
        withTunedConstants(tuned, () => {
          const { course, routeMetricPoints, length } = stopsCourse({ a: 0, b: bStopSeconds, c: 0 }, withCurve);
          const project = (
            ping: { pingId: string; latitude: number; longitude: number; recordedAt: string },
            previousPing: typeof ping | null,
            previous: ReturnType<typeof recomputeRaceProjection>["state"] | null
          ) =>
            recomputeRaceProjection({
              roomId: "room-1",
              activatedAt: START_AT,
              course,
              plannedPaceSecondsPerKm: 600,
              ping,
              previousPing,
              previous,
              routeMetricPoints
            });
          const p0 = { pingId: "p0", latitude: 10.0, longitude: 20.0, recordedAt: START_AT };
          const p1 = { pingId: "p1", latitude: 10.005, longitude: 20.0, recordedAt: at(330) };
          const p2 = { pingId: "p2", latitude: 10.015, longitude: 20.0, recordedAt: at(1000) };
          const first = project(p0, null, null);
          const before = project(p1, p0, first.state);
          const after = project(p2, p1, before.state);
          return { length, before: before.projection, after: after.projection };
        });

      const withStop = race(600);
      const withoutStop = race(0);
      const b = withStop.after.checkpointSplits[1]!;
      assert.ok(withStop.after.progressMeters > b.distanceMetersFromStart + 150, `${label}: the runner is past b`);
      assert.deepEqual(b.visits, [], `${label}: no ping landed inside b's radius`);
      // Still ahead of the runner, b's stop counts.
      assert.ok(
        finishSeconds(withStop.before.etaFinishPlanIso) - finishSeconds(withoutStop.before.etaFinishPlanIso) > 0,
        `${label}: before b, its stop is on the way to the finish`
      );
      // Behind the runner, it does not: the finish is the same as with no stop planned there.
      assert.equal(
        withStop.after.etaFinishPlanIso,
        withoutStop.after.etaFinishPlanIso,
        `${label}: b is behind the runner, its 600 s stop is not ahead of the finish`
      );
      if (!tuned && !withCurve) {
        const remaining = withStop.length - withStop.after.progressMeters;
        assert.ok(
          Math.abs(finishSeconds(withStop.after.etaFinishPlanIso) - (1000 + (remaining / 1000) * 600)) < 0.01,
          `${label}: the ping plus the rest at plan pace, ${withStop.after.etaFinishPlanIso}`
        );
      }
    }
  }
});

test("a course with no finish checkpoint gets a route-end finish row id that names none of its checkpoints", () => {
  assert.equal(routeEndFinishRowId(atDistances([0, 10_000, 30_000]), 40_000), "finish", "a last aid short of the route's end");
  assert.equal(routeEndFinishRowId(atDistances([0, 10_000, 40_000]), 40_000), undefined, "a checkpoint at the end is the finish");
  assert.equal(routeEndFinishRowId(atDistances([0, 10_000, undefined]), 40_000), undefined, "a distance unknown");
  assert.equal(routeEndFinishRowId(atDistances([0]), 40_000), undefined, "the start alone");
  // An earlier `finish` (a loop's first pass) that is not the farthest: the row takes another id.
  const loop: FinishCandidate[] = [
    { id: "start", distanceMetersFromStart: 0 },
    { id: "finish", distanceMetersFromStart: 10_000 },
    { id: "aid-2", distanceMetersFromStart: 30_000 }
  ];
  assert.equal(routeEndFinishRowId(loop, 40_000), "route-finish");
  assert.equal(routeEndFinishRowId([...loop, { id: "route-finish", distanceMetersFromStart: 20_000 }], 40_000), "route-finish-2");
  // In any case, as the finish rule reads ids.
  const upper = loop.map((checkpoint) => (checkpoint.id === "finish" ? { ...checkpoint, id: "Finish" } : checkpoint));
  assert.equal(routeEndFinishRowId(upper, 40_000), "route-finish");
  assert.equal(routeEndFinishRowId([...upper, { id: " ROUTE-FINISH ", distanceMetersFromStart: 20_000 }], 40_000), "route-finish-2");
});

test("a checkpoint's next visit index is one past its highest, gaps kept", () => {
  assert.equal(nextVisitIndex([]), 1);
  assert.equal(nextVisitIndex([{ visitIndex: 1 }, { visitIndex: 2 }]), 3);
  assert.equal(nextVisitIndex([{ visitIndex: 2 }]), 3, "visit 1 dropped: 2 is not reused");
});
