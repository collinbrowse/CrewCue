import test from "node:test";
import assert from "node:assert/strict";
import type { RaceCourse } from "@crewcue/contracts";
import {
  cumulativeDistanceAtCheckpoints,
  polylineCourseLengthAndProgress,
  recomputeRaceProjection
} from "./raceProjection.js";

test("polyline progress is near midpoint on straight two-segment course", () => {
  const course: RaceCourse = {
    checkpoints: [
      { id: "a", latitude: 41.0, longitude: -71.0 },
      { id: "b", latitude: 41.002, longitude: -71.0 },
      { id: "c", latitude: 41.004, longitude: -71.0 }
    ]
  };
  const { courseLengthMeters, progressMeters } = polylineCourseLengthAndProgress(
    course.checkpoints,
    41.001,
    -71.0
  );
  const cum = cumulativeDistanceAtCheckpoints(course.checkpoints);
  const expectedMid = cum[1] / 2;
  assert.ok(Math.abs(progressMeters - expectedMid) < 3, `progress ${progressMeters} vs ${expectedMid}`);
  assert.ok(Math.abs(courseLengthMeters - cum[cum.length - 1]) < 0.01);
});

test("recompute is deterministic for fixed inputs", () => {
  const course: RaceCourse = {
    checkpoints: [
      { id: "a", latitude: 10.0, longitude: 20.0 },
      { id: "b", latitude: 10.01, longitude: 20.0 }
    ]
  };
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
    previous: null
  });
  const second = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt,
    course,
    plannedPaceSecondsPerKm: 600,
    ping,
    previous: null
  });
  assert.deepEqual(first.projection, second.projection);
  assert.ok(first.projection.weatherStub);
  assert.equal(first.projection.weatherStub?.source, "stub");
  assert.ok(typeof first.projection.weatherStub?.assumedHeadwindMps === "number");
});

test("baseline track drives planned splits and anchors ETA to the last crossed checkpoint", () => {
  const checkpoints = [
    { id: "a", latitude: 10.0, longitude: 20.0 },
    { id: "b", latitude: 10.01, longitude: 20.0 },
    { id: "c", latitude: 10.02, longitude: 20.0 }
  ];
  const cum = cumulativeDistanceAtCheckpoints(checkpoints);
  const course: RaceCourse = {
    checkpoints,
    baselineTrack: {
      points: [
        { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
        { distanceMetersFromStart: cum[1]!, referenceElapsedSeconds: 300 },
        { distanceMetersFromStart: cum[2]!, referenceElapsedSeconds: 720 }
      ]
    }
  };
  const flatCourse: RaceCourse = { checkpoints };
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
    previous: null
  });
  const baselineMidSegment = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt,
    course,
    plannedPaceSecondsPerKm: 600,
    ping: midSegmentPing,
    previous: baselineCheckpoint.state
  });
  const flatCheckpoint = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt,
    course: flatCourse,
    plannedPaceSecondsPerKm: 600,
    ping: checkpointPing,
    previous: null
  });
  const flatMidSegment = recomputeRaceProjection({
    roomId: "room-1",
    activatedAt,
    course: flatCourse,
    plannedPaceSecondsPerKm: 600,
    ping: midSegmentPing,
    previous: flatCheckpoint.state
  });

  assert.equal(baselineMidSegment.projection.checkpointSplits[1]?.plannedElapsedSecondsAtCross, 300);
  assert.equal(baselineMidSegment.projection.checkpointSplits[2]?.plannedElapsedSecondsAtCross, 720);
  assert.equal(baselineMidSegment.projection.checkpointSplits[1]?.actualElapsedSecondsAtCross, 360);
  assert.equal(baselineMidSegment.projection.etaFinishPlanIso, "2026-04-16T12:13:00.000Z");
  assert.notEqual(flatMidSegment.projection.etaFinishPlanIso, baselineMidSegment.projection.etaFinishPlanIso);
  assert.ok(
    baselineMidSegment.projection.progressMeters > baselineCheckpoint.projection.progressMeters,
    "progress should still advance within the anchored segment"
  );
});

test("stoppage accumulates slowed intervals inside checkpoint radius", () => {
  const checkpoints = [
    { id: "a", latitude: 10.0, longitude: 20.0, plannedStopSeconds: 120, stoppageRadiusMeters: 800 },
    { id: "b", latitude: 10.02, longitude: 20.0 }
  ];
  const course: RaceCourse = { checkpoints };
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
    previous: null
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
    previous: first.state
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
    previous: second.state
  });
  const split = third.projection.checkpointSplits[0]!;
  assert.equal(split.plannedStopSeconds, 120);
  assert.equal(split.visits.length, 1);
  assert.ok((split.totalActualStopSeconds ?? 0) > 0);
  assert.ok(split.deltaStopSeconds !== null);
  assert.equal(third.projection.stoppageSummary.totalActualStopSeconds, 0);
});
