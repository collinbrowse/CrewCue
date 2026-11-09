/**
 * Regenerates the FIT and TCX activity fixtures from `activity-short-road.gpx` so all three
 * formats describe the same 8 km run. Run: `npx tsx fixtures/pacing/make-activity-files.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeElevationGainMeters, computeTrackDistanceMeters, parseGpxActivityTrack } from "../../packages/map-core/src/courseParse.ts";
import { encodeFitActivity } from "../../packages/map-core/src/fitTestEncoder.ts";
import { PACING_FIXTURES_DIR } from "./load.ts";

const gpx = parseGpxActivityTrack(readFileSync(join(PACING_FIXTURES_DIR, "activity-short-road.gpx"), "utf8"));
const points = gpx.points;
const cumulative: number[] = points.map((_, index) => computeTrackDistanceMeters(points.slice(0, index + 1)));
const startMs = points[0]!.timestampMs!;
const endMs = points[points.length - 1]!.timestampMs!;
const totalMeters = cumulative[cumulative.length - 1]!;
const ascent = Math.round(computeElevationGainMeters(points));

const fit = encodeFitActivity({
  records: points.map((point, index) => ({
    timestampMs: point.timestampMs!,
    latitude: point.latitude,
    longitude: point.longitude,
    elevationMeters: point.elevationMeters ?? undefined,
    distanceMeters: cumulative[index]
  })),
  session: { startMs, elapsedSeconds: (endMs - startMs) / 1000, distanceMeters: totalMeters, ascentMeters: ascent }
});
writeFileSync(join(PACING_FIXTURES_DIR, "activity-short-road.fit"), fit);

// Treadmill: distance from the foot pod, no GPS.
const treadmill = encodeFitActivity({
  records: Array.from({ length: 31 }, (_, index) => ({
    timestampMs: startMs + index * 60_000,
    distanceMeters: index * 200
  })),
  session: { startMs, elapsedSeconds: 1800, distanceMeters: 6000 }
});
writeFileSync(join(PACING_FIXTURES_DIR, "activity-treadmill.fit"), treadmill);

// Corrupt: the short-road FIT cut in half.
writeFileSync(join(PACING_FIXTURES_DIR, "corrupt.fit"), fit.subarray(0, Math.floor(fit.length / 2)));

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const trackpoints = points
  .map(
    (point, index) => `          <Trackpoint>
            <Time>${iso(point.timestampMs!)}</Time>
            <Position>
              <LatitudeDegrees>${point.latitude.toFixed(6)}</LatitudeDegrees>
              <LongitudeDegrees>${point.longitude.toFixed(6)}</LongitudeDegrees>
            </Position>
            <AltitudeMeters>${(point.elevationMeters ?? 0).toFixed(1)}</AltitudeMeters>
            <DistanceMeters>${cumulative[index]!.toFixed(1)}</DistanceMeters>
          </Trackpoint>`
  )
  .join("\n");
const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>${iso(startMs)}</Id>
      <Lap StartTime="${iso(startMs)}">
        <TotalTimeSeconds>${((endMs - startMs) / 1000).toFixed(1)}</TotalTimeSeconds>
        <DistanceMeters>${totalMeters.toFixed(1)}</DistanceMeters>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${trackpoints}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
writeFileSync(join(PACING_FIXTURES_DIR, "activity-short-road.tcx"), tcx);
console.log(`fit ${fit.length} B, treadmill ${treadmill.length} B, tcx ${tcx.length} B, ${totalMeters.toFixed(0)} m`);
