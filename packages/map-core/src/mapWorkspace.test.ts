import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIMARY_COURSE_ROUTE_LAYER_ID,
  mergePrimaryCourseRouteLayer,
  parsedTrackToWorkspaceLayer
} from "./mapWorkspace.js";
import type { ParsedGpxTrack } from "./courseParse.js";

test("mergePrimaryCourseRouteLayer replaces canonical layer and aligns checkpoints", () => {
  const parsed: ParsedGpxTrack = {
    points: [
      { latitude: 1, longitude: 2, elevationMeters: null, timestampMs: null },
      { latitude: 1.1, longitude: 2.1, elevationMeters: null, timestampMs: null }
    ],
    waypoints: [],
    totalDistanceMeters: 100,
    startTimestampMs: 0,
    endTimestampMs: 1,
    totalDurationSeconds: 1,
    averagePaceSecondsPerKm: 300
  };
  const overlay = parsedTrackToWorkspaceLayer("race.gpx", parsed);
  assert.notEqual(overlay.id, PRIMARY_COURSE_ROUTE_LAYER_ID);
  const prev = mergePrimaryCourseRouteLayer(
    {
      layers: [{ ...overlay, id: PRIMARY_COURSE_ROUTE_LAYER_ID }],
      checkpoints: [{ id: "old", latitude: 0, longitude: 0 }]
    },
    overlay,
    [
      { id: "a", latitude: 10, longitude: 20, plannedStopSeconds: 60 },
      { id: "b", latitude: 11, longitude: 21, plannedStopSeconds: 60 }
    ]
  );
  assert.equal(prev.layers.filter((l) => l.id === PRIMARY_COURSE_ROUTE_LAYER_ID).length, 1);
  assert.equal(prev.checkpoints.length, 2);
  assert.equal(prev.selectedLayerId, PRIMARY_COURSE_ROUTE_LAYER_ID);
  assert.equal(prev.drivesProjectionLayerId, PRIMARY_COURSE_ROUTE_LAYER_ID);
});
