/**
 * Regenerates the FIT and TCX activity fixtures from `activity-short-road.gpx` so all three
 * formats describe the same 8 km run, plus `activity-hill-run.fit` (dense, with cadence). Run: `npx tsx fixtures/pacing/make-activity-files.ts`.
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
// Hill run: one point a second with cadence (strides per minute, as FIT stores it). 1 km flat
// running, 800 m at 14% hiking, a 90 s stop, then 1 km at −9% running. For the grade profile.
const hillStartMs = Date.parse("2026-05-17T14:00:00Z");
const hillRecords: Parameters<typeof encodeFitActivity>[0]["records"] = [];
{
  let meters = 0;
  let elevation = 1200;
  let seconds = 0;
  const push = (cadence: number) =>
    hillRecords.push({
      timestampMs: hillStartMs + Math.round(seconds) * 1000,
      latitude: 39.5 + meters / 111_195,
      longitude: -106.0,
      elevationMeters: Math.round(elevation * 5) / 5,
      distanceMeters: meters,
      cadence
    });
  push(86);
  const legs = [
    { meters: 1000, grade: 0, speed: 3, cadence: 86, stop: 0 },
    { meters: 800, grade: 0.14, speed: 1, cadence: 56, stop: 0 },
    { meters: 1000, grade: -0.09, speed: 3.4, cadence: 88, stop: 90 }
  ];
  for (const leg of legs) {
    for (let s = 0; s < leg.stop; s += 1) {
      seconds += 1;
      push(0);
    }
    let left = leg.meters;
    while (left > 1e-9) {
      const step = Math.min(leg.speed, left);
      meters += step;
      elevation += step * leg.grade;
      seconds += 1;
      left -= step;
      push(leg.cadence);
    }
  }
}
const hillLast = hillRecords[hillRecords.length - 1]!;
const hillFit = encodeFitActivity({
  records: hillRecords,
  session: {
    startMs: hillStartMs,
    elapsedSeconds: (hillLast.timestampMs - hillStartMs) / 1000,
    distanceMeters: hillLast.distanceMeters!,
    ascentMeters: 112
  }
});
writeFileSync(join(PACING_FIXTURES_DIR, "activity-hill-run.fit"), hillFit);

console.log(`hill fit ${hillFit.length} B`);
console.log(`fit ${fit.length} B, treadmill ${treadmill.length} B, tcx ${tcx.length} B, ${totalMeters.toFixed(0)} m`);
