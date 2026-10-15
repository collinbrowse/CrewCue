import assert from "node:assert/strict";
import test from "node:test";
import { coursePreviewFromGpx } from "./courseGpxRoutes.js";

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-test">
  <trk><trkseg>
    <trkpt lat="37.780000" lon="-122.420000"></trkpt>
    <trkpt lat="37.782000" lon="-122.420000"></trkpt>
    <trkpt lat="37.784000" lon="-122.420000"></trkpt>
  </trkseg></trk>
</gpx>`;

test("course gpx preview is parsed on the server", () => {
  const preview = coursePreviewFromGpx(GPX, "route.gpx");
  assert.ok(preview.course.checkpoints.length >= 2);
  assert.equal(preview.courseFileName, "route.gpx");
  assert.equal(preview.routeOverlayLayer.geometry.type, "LineString");
  assert.ok(preview.plannedPaceSecondsPerKm > 0);
});
