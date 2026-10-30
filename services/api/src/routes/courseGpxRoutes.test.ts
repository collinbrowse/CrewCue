import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../app.js";
import { MAX_GPX_XML_CHARS } from "../lib/gpxLimits.js";
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

test("rejects oversized GPX payloads on course gpx-preview", async () => {
  const app = buildApp();
  await app.ready();
  try {
    const token = app.jwt.sign({ sub: "owner-gpx-limit", teamIds: ["team-1"], roomRoles: {} });
    const headers = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: "POST",
      url: "/race-rooms",
      headers,
      payload: { teamId: "team-1", athleteId: "owner-gpx-limit", name: "GPX limit", creatorRole: "team_manager" }
    });
    assert.equal(created.statusCode, 201);
    const roomId = (created.json() as { id: string }).id;
    const url = `/race-rooms/${roomId}/course/gpx-preview`;

    const oversized = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { gpxXml: "x".repeat(MAX_GPX_XML_CHARS + 1), courseFileName: "route.gpx" }
    });
    assert.equal(oversized.statusCode, 400);
    assert.deepEqual(oversized.json(), { error: "Invalid GPX payload" });

    const ok = await app.inject({ method: "POST", url, headers, payload: { gpxXml: GPX, courseFileName: "route.gpx" } });
    assert.equal(ok.statusCode, 200);
  } finally {
    await app.close();
  }
});
