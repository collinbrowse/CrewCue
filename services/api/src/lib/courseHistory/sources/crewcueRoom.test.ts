import test from "node:test";
import assert from "node:assert/strict";
import type { RaceCourse } from "@crewcue/contracts";
import { checkpointsWithProjectedDistances } from "@crewcue/map-core";
import { crewCueRoomToCourseHistoryEvent, type TrackPoint } from "./crewcueRoom.js";

// Straight course north: start, an aid ~5.6 km in, finish ~11.1 km.
const raw = [
  { id: "start", title: "Start", latitude: 40.0, longitude: -105.0 },
  { id: "aid", title: "Aid", latitude: 40.05, longitude: -105.0 },
  { id: "finish", title: "Finish", latitude: 40.1, longitude: -105.0 }
];
const route = Array.from({ length: 101 }, (_, i) => ({ latitude: 40 + i * 0.001, longitude: -105.0 }));
const course: RaceCourse = { checkpoints: checkpointsWithProjectedDistances(raw, route) };
const START = Date.parse("2026-07-01T12:00:00Z");

/** A point every 3 minutes, 0.01° (~1.1 km) each, with `stopPings` stationary pings at the aid. */
function track(stopPings: number, lastLat = 40.1): TrackPoint[] {
  const points: TrackPoint[] = [];
  let t = 0;
  const push = (lat: number) => {
    points.push({ recordedAt: new Date(START + t * 1000).toISOString(), latitude: lat, longitude: -105.0 });
    t += 180;
  };
  for (let lat = 40.0; lat < 40.05 - 1e-9; lat += 0.01) {
    push(lat);
  }
  for (let i = 0; i <= stopPings; i += 1) {
    push(40.05);
  }
  for (let lat = 40.06; lat <= lastLat + 1e-9; lat += 0.01) {
    push(lat);
  }
  return points;
}

const input = (points: TrackPoint[]) => ({
  roomId: "room-1",
  name: "Test 11K",
  raceStartAt: new Date(START).toISOString(),
  course,
  routeMetricPoints: route,
  track: points
});

test("a finished room becomes one valid effort with an in and out time at the aid", () => {
  const event = crewCueRoomToCourseHistoryEvent(input(track(4)));
  assert.ok(event);
  assert.equal(event.source, "crewcue");
  assert.equal(event.sourceEventId, "room-1");
  assert.deepEqual(
    event.checkpoints.map((cp) => cp.id),
    ["start", "aid", "finish"]
  );
  const [aid, finish] = event.efforts[0]!.splits;
  assert.equal(aid!.checkpointId, "aid");
  assert.equal(aid!.inSeconds, 5 * 180);
  assert.equal(aid!.outSeconds, aid!.inSeconds + 4 * 180, "four stationary intervals at the aid are the stop");
  assert.equal(finish!.checkpointId, "finish");
  assert.equal(finish!.outSeconds, undefined);
  assert.ok(finish!.inSeconds > aid!.outSeconds!);
});

test("no detected stop leaves the out time off", () => {
  const event = crewCueRoomToCourseHistoryEvent(input(track(0)));
  assert.ok(event);
  assert.equal(event.efforts[0]!.splits[0]!.outSeconds, undefined);
});

test("a runner who never reaches the finish is not course history", () => {
  assert.equal(crewCueRoomToCourseHistoryEvent(input(track(2, 40.08))), null);
  assert.equal(crewCueRoomToCourseHistoryEvent(input([])), null);
});
