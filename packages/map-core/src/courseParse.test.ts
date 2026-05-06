import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExpectedAidStationSplitsFromCourse,
  buildExpectedSplits,
  parseCourseTrack,
  buildRaceCourseFromGpx,
  formatDistance,
  formatPace,
  parseGpxTrack
} from "./courseParse.js";

const validGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-test">
  <trk>
    <name>Demo route</name>
    <trkseg>
      <trkpt lat="40.712776" lon="-74.005974"><ele>10.2</ele><time>2026-04-29T12:00:00Z</time></trkpt>
      <trkpt lat="40.717776" lon="-74.000974"><ele>11.0</ele><time>2026-04-29T12:05:00Z</time></trkpt>
      <trkpt lat="40.722776" lon="-73.995974"><ele>12.0</ele><time>2026-04-29T12:10:00Z</time></trkpt>
      <trkpt lat="40.727776" lon="-73.990974"><ele>12.8</ele><time>2026-04-29T12:15:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

test("parseGpxTrack parses points and pace from valid GPX", () => {
  const parsed = parseGpxTrack(`${validGpx}<wpt lat="40.718" lon="-74.001"><name>Aid 1</name></wpt>`);
  assert.equal(parsed.points.length, 4);
  assert.equal(parsed.waypoints.length, 1);
  assert.ok(parsed.totalDistanceMeters > 2000);
  assert.equal(parsed.totalDurationSeconds, 900);
  assert.ok(parsed.averagePaceSecondsPerKm > 300);
});

test("buildExpectedSplits creates kilometer split rows", () => {
  const parsed = parseGpxTrack(validGpx);
  const splits = buildExpectedSplits(parsed, "km");
  assert.ok(splits.length >= 2);
  assert.equal(splits[0].distanceLabel, "1 km");
  assert.match(splits[0].elapsedLabel, /^\d+:\d{2}$/);
});

test("buildExpectedSplits creates mile split rows", () => {
  const parsed = parseGpxTrack(validGpx);
  const splits = buildExpectedSplits(parsed, "mi");
  assert.ok(splits.length >= 1);
  assert.equal(splits[0].distanceLabel, "1 mi");
});

test("parseGpxTrack allows missing timestamps with fallback pace", () => {
  const noTimeGpx = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="1" lon="1"></trkpt><trkpt lat="1.1" lon="1.1"></trkpt></trkseg></trk></gpx>`;
  const parsed = parseGpxTrack(noTimeGpx);
  assert.ok(parsed.totalDurationSeconds > 0);
  assert.equal(parsed.startTimestampMs, 0);
});

test("parseGpxTrack accepts namespaced GPX route points", () => {
  const namespacedGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="device-export" xmlns:ns="http://example.com/ns">
  <rte>
    <ns:rtept lat="40.712776" lon="-74.005974"><ns:time>2026-04-29T12:00:00Z</ns:time></ns:rtept>
    <ns:rtept lat="40.717776" lon="-74.000974"><ns:time>2026-04-29T12:05:00Z</ns:time></ns:rtept>
    <ns:rtept lat="40.722776" lon="-73.995974"><ns:time>2026-04-29T12:10:00Z</ns:time></ns:rtept>
  </rte>
</gpx>`;

  const parsed = parseGpxTrack(namespacedGpx);
  assert.equal(parsed.points.length, 3);
  assert.ok(parsed.totalDistanceMeters > 1000);
});

test("buildRaceCourseFromGpx uses waypoint checkpoints and baseline track", () => {
  const gpxWithAidStations = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-test">
  <wpt lat="40.712776" lon="-74.005974"><name>Aid 1</name></wpt>
  <wpt lat="40.722776" lon="-73.995974"><name>Aid 2</name></wpt>
  <trk><trkseg>
    <trkpt lat="40.712776" lon="-74.005974"><time>2026-04-29T12:00:00Z</time></trkpt>
    <trkpt lat="40.722776" lon="-73.995974"><time>2026-04-29T12:10:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
  const parsed = parseGpxTrack(gpxWithAidStations);
  const { course, plannedPaceSecondsPerKm } = buildRaceCourseFromGpx(parsed);
  assert.equal(course.checkpoints.length, 2);
  assert.equal(course.checkpoints[0]?.id, "aid-1");
  assert.ok((course.baselineTrack?.points.length ?? 0) >= 2);
  assert.ok((course.baselineTrack?.points.length ?? 0) <= 220);
  assert.ok(plannedPaceSecondsPerKm > 0);
});

test("buildExpectedAidStationSplitsFromCourse computes checkpoint splits", () => {
  const parsed = parseGpxTrack(validGpx);
  const { course, plannedPaceSecondsPerKm } = buildRaceCourseFromGpx(parsed);
  const summary = buildExpectedAidStationSplitsFromCourse(course, plannedPaceSecondsPerKm, "mi");
  assert.ok(summary.totalDistanceMeters > 0);
  assert.ok(summary.totalDurationSeconds > 0);
  assert.ok(summary.splits.length >= 2);
});

test("parseCourseTrack supports KML routes", () => {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml>
  <Document>
    <Placemark>
      <name>Aid A</name>
      <Point><coordinates>-74.005974,40.712776,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Aid B</name>
      <Point><coordinates>-73.995974,40.722776,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <LineString>
        <coordinates>
          -74.005974,40.712776,0 -74.000974,40.717776,0 -73.995974,40.722776,0
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
  const parsed = parseCourseTrack(kml, "route.kml");
  assert.ok(parsed.points.length >= 3);
  assert.ok(parsed.totalDistanceMeters > 1000);
});

test("parseCourseTrack supports JSON/GeoJSON routes", () => {
  const geojson = JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-74.005974, 40.712776],
            [-74.000974, 40.717776],
            [-73.995974, 40.722776]
          ]
        }
      },
      {
        type: "Feature",
        properties: { name: "Start" },
        geometry: { type: "Point", coordinates: [-74.005974, 40.712776] }
      },
      {
        type: "Feature",
        properties: { name: "Aid 1" },
        geometry: { type: "Point", coordinates: [-74.000974, 40.717776] }
      },
      {
        type: "Feature",
        properties: { name: "Finish" },
        geometry: { type: "Point", coordinates: [-73.995974, 40.722776] }
      }
    ]
  });
  const parsed = parseCourseTrack(geojson, "route.json");
  assert.ok(parsed.points.length >= 3);
  assert.ok(parsed.totalDistanceMeters > 1000);
  assert.equal(parsed.waypoints.length, 3);
});

test("parseCourseTrack supports nested JSON coordinate arrays", () => {
  const nestedJson = JSON.stringify({
    payload: {
      route: {
        segments: [
          {
            points: [
              { lat: 40.712776, lon: -74.005974 },
              { lat: 40.717776, lon: -74.000974 },
              { lat: 40.722776, lon: -73.995974 }
            ]
          }
        ]
      }
    }
  });
  const parsed = parseCourseTrack(nestedJson, "nested.json");
  assert.ok(parsed.points.length >= 3);
});

test("buildRaceCourseFromGpx downsamples very large baselines", () => {
  const coords: string[] = [];
  for (let i = 0; i < 1200; i += 1) {
    coords.push(`${-107.6 + i * 0.0001},${37.7 + i * 0.0001}`);
  }
  const geojson = JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords.map((c) => c.split(",").map(Number)) } }]
  });
  const parsed = parseCourseTrack(geojson, "big.json");
  const { course } = buildRaceCourseFromGpx(parsed);
  assert.ok((course.baselineTrack?.points.length ?? 0) <= 220);
});

test("format helpers stay presenter friendly", () => {
  assert.equal(formatDistance(3210, "km"), "3.21 km");
  assert.equal(formatDistance(3218.688, "mi"), "2.00 mi");
  assert.equal(formatPace(345), "5:45/km");
  assert.equal(formatPace(345, "mi"), "9:15/mi");
});

test("buildRaceCourseFromGpx prefers station-like waypoints when present", () => {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-test">
  <wpt lat="40.712776" lon="-74.005974"><name>Start</name></wpt>
  <wpt lat="40.716000" lon="-74.002000"><name>Scenic turnout</name></wpt>
  <wpt lat="40.719000" lon="-73.999000"><name>Aid Station 1</name></wpt>
  <wpt lat="40.722776" lon="-73.995974"><name>Finish</name></wpt>
  <trk><trkseg>
    <trkpt lat="40.712776" lon="-74.005974"></trkpt>
    <trkpt lat="40.716000" lon="-74.002000"></trkpt>
    <trkpt lat="40.719000" lon="-73.999000"></trkpt>
    <trkpt lat="40.722776" lon="-73.995974"></trkpt>
  </trkseg></trk>
</gpx>`;
  const parsed = parseGpxTrack(gpx);
  const { course } = buildRaceCourseFromGpx(parsed);
  assert.deepEqual(
    course.checkpoints.map((cp) => cp.id),
    ["start", "aid-station-1", "finish"]
  );
});

test("buildRaceCourseFromGpx keeps all waypoints when none are station-like", () => {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-test">
  <wpt lat="40.712776" lon="-74.005974"><name>Oak tree</name></wpt>
  <wpt lat="40.717776" lon="-74.000974"><name>River bend</name></wpt>
  <wpt lat="40.722776" lon="-73.995974"><name>Lookout</name></wpt>
  <trk><trkseg>
    <trkpt lat="40.712776" lon="-74.005974"></trkpt>
    <trkpt lat="40.717776" lon="-74.000974"></trkpt>
    <trkpt lat="40.722776" lon="-73.995974"></trkpt>
  </trkseg></trk>
</gpx>`;
  const parsed = parseGpxTrack(gpx);
  const { course } = buildRaceCourseFromGpx(parsed);
  assert.equal(course.checkpoints.length, 3);
  assert.deepEqual(course.checkpoints.map((cp) => cp.id), ["oak-tree", "river-bend", "lookout"]);
});

test("buildRaceCourseFromGpx deduplicates repeated waypoint names", () => {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-test">
  <wpt lat="40.712776" lon="-74.005974"><name>Town Park Start Finish</name></wpt>
  <wpt lat="40.717776" lon="-74.000974"><name>Town Park Start Finish</name></wpt>
  <trk><trkseg>
    <trkpt lat="40.712776" lon="-74.005974"></trkpt>
    <trkpt lat="40.717776" lon="-74.000974"></trkpt>
    <trkpt lat="40.722776" lon="-73.995974"></trkpt>
  </trkseg></trk>
</gpx>`;
  const parsed = parseGpxTrack(gpx);
  const { course } = buildRaceCourseFromGpx(parsed);
  assert.deepEqual(course.checkpoints.map((cp) => cp.id), ["town-park-start-finish", "town-park-start-finish-2"]);
  assert.notEqual(course.checkpoints[0]!.longitude, course.checkpoints[1]!.longitude);
});

test("buildRaceCourseFromGpx creates multiple checkpoints when one waypoint is encountered multiple times", () => {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-test">
  <wpt lat="40.717700" lon="-74.000900"><name>Aid Station Loop</name></wpt>
  <trk><trkseg>
    <trkpt lat="40.712776" lon="-74.005974"></trkpt>
    <trkpt lat="40.717700" lon="-74.000900"></trkpt>
    <trkpt lat="40.722776" lon="-73.995974"></trkpt>
    <trkpt lat="40.717700" lon="-74.000900"></trkpt>
    <trkpt lat="40.712776" lon="-74.005974"></trkpt>
  </trkseg></trk>
</gpx>`;
  const parsed = parseGpxTrack(gpx);
  const { course } = buildRaceCourseFromGpx(parsed);
  assert.deepEqual(course.checkpoints.map((cp) => cp.id), ["aid-station-loop", "aid-station-loop-2"]);
});
