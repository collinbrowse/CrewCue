import test from "node:test";
import assert from "node:assert/strict";
import type { RaceCourse } from "@crewcue/contracts";
import {
  cumulativeDistancesAlongCheckpoints,
  latLngAtDistanceAlongCheckpointCourse,
  lngLatAtDistanceAlongPolyline,
  primaryCourseLngLatPolyline,
  remainingGainAndLossMetersAfter
} from "./coursePosition.js";

const tinyCourse: RaceCourse = {
  checkpoints: [
    { id: "a", latitude: 40.0, longitude: -74.0 },
    { id: "b", latitude: 40.001, longitude: -74.0 },
    { id: "c", latitude: 40.002, longitude: -74.0 }
  ]
};

test("cumulativeDistancesAlongCheckpoints starts at zero and ends at total path length", () => {
  const cum = cumulativeDistancesAlongCheckpoints(tinyCourse.checkpoints);
  assert.equal(cum.length, 3);
  assert.equal(cum[0], 0);
  assert.ok(cum[2]! > cum[1]!);
});

test("latLngAtDistanceAlongCheckpointCourse returns start at zero and approaches end", () => {
  const at0 = latLngAtDistanceAlongCheckpointCourse(tinyCourse, 0);
  assert.ok(at0);
  assert.equal(at0!.latitude, 40.0);
  const cum = cumulativeDistancesAlongCheckpoints(tinyCourse.checkpoints);
  const total = cum[2]!;
  const atEnd = latLngAtDistanceAlongCheckpointCourse(tinyCourse, total);
  assert.ok(atEnd);
  assert.ok(Math.abs(atEnd!.latitude - 40.002) < 1e-6);
});

test("lngLatAtDistanceAlongPolyline interpolates along GeoJSON line", () => {
  const line: [number, number][] = [
    [-74.0, 40.0],
    [-74.0, 40.002]
  ];
  const mid = lngLatAtDistanceAlongPolyline(line, 50);
  assert.ok(mid);
  assert.ok(mid![1] > 40.0 && mid![1] < 40.002);
});

test("primaryCourseLngLatPolyline prefers the projection-driving route layer", () => {
  const line = primaryCourseLngLatPolyline(tinyCourse, {
    drivesProjectionLayerId: "driver",
    selectedLayerId: "decoy",
    checkpoints: tinyCourse.checkpoints,
    layers: [
      {
        id: "decoy",
        label: "Visible decoy",
        visible: true,
        geometry: {
          type: "LineString",
          coordinates: [
            [-73, 41],
            [-73, 42]
          ]
        }
      },
      {
        id: "driver",
        label: "Projection driver",
        visible: false,
        geometry: {
          type: "LineString",
          coordinates: [
            [-74, 40],
            [-74, 40.002]
          ]
        }
      }
    ]
  });

  assert.deepEqual(line, [
    [-74, 40],
    [-74, 40.002]
  ]);
});

test("remainingGainAndLossMetersAfter prefers gain then loss rule inputs", () => {
  const samples = [
    { distanceMetersFromStart: 0, elevationMeters: 0 },
    { distanceMetersFromStart: 100, elevationMeters: 50 },
    { distanceMetersFromStart: 200, elevationMeters: 20 }
  ];
  const after0 = remainingGainAndLossMetersAfter(samples, 0);
  assert.ok(after0);
  assert.equal(after0!.gainRemainingMeters, 50);
  assert.equal(after0!.lossRemainingMeters, 30);

  const after150 = remainingGainAndLossMetersAfter(samples, 150);
  assert.ok(after150);
  assert.ok(after150!.gainRemainingMeters === 0);
  assert.ok(after150!.lossRemainingMeters > 0);
});
