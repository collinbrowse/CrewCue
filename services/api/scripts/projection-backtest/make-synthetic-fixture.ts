/**
 * Writes the SYNTHETIC fixture in `fixtures/projection-backtest/` (no real race data).
 *
 *   npm run projection:backtest:make-fixture -w @crewcue/api
 *
 * Three made-up courses. Runners follow the micro-model's shape with a known late-race slowdown,
 * a night penalty, per-section noise and aid stops, so the backtest has signal to find and CI has
 * something stable to run. Rerunning is deterministic; commit the output only if it changed on purpose.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CourseHistoryEvent, CourseHistoryEffort } from "../../src/lib/courseHistory/format.js";
import { buildCoursePlan, checkpointGpxDistances, planAt, type Manifest } from "./data.js";
import { darkShare } from "./formulas.js";
import { SeededRandom } from "./stats.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const outDir = resolve(repoRoot, "fixtures/projection-backtest");

const TRUE_SLOWDOWN = 0.3;
const TRUE_NIGHT = 1.06;

function syntheticGpx(name: string, startLat: number, startLon: number, km: number, climbs: number, reliefM: number): string {
  const points: string[] = [];
  const steps = Math.round(km * 4);
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps;
    const lat = startLat + (f * km * 0.6) / 111.32;
    const lon = startLon + (f * km * 0.8) / (111.32 * Math.cos((startLat * Math.PI) / 180));
    const ele = 1200 + reliefM * 0.5 * (1 - Math.cos(2 * Math.PI * climbs * f)) + 150 * Math.sin(9 * Math.PI * f);
    points.push(`      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`);
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="crewcue-synthetic" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <trk><name>${name} (SYNTHETIC)</name><trkseg>`,
    ...points,
    "  </trkseg></trk>",
    "</gpx>",
    ""
  ].join("\n");
}

type CourseSpec = {
  course: string;
  gpxFile: string;
  gpxXml: string;
  aidKm: number[];
  withLatLon: boolean;
  events: Array<{ id: string; start: string; runners: number }>;
};

function makeEvent(spec: CourseSpec, ev: CourseSpec["events"][number], rng: SeededRandom): CourseHistoryEvent {
  const plan = buildCoursePlan(spec.course, spec.gpxXml);
  const totalKm = plan.lengthMeters / 1000;
  const kms = [0, ...spec.aidKm, Math.round(totalKm * 10) / 10];
  const routeAt = (km: number) => plan.route[Math.round((km / totalKm) * (plan.route.length - 1))]!;
  const checkpoints = kms.map((km, i) => ({
    id: i === 0 ? "start" : i === kms.length - 1 ? "finish" : `aid-${i}`,
    name: i === 0 ? "Start" : i === kms.length - 1 ? "Finish" : `Aid ${i}`,
    distanceMeters: Math.round(km * 1000),
    ...(spec.withLatLon ? { latitude: routeAt(km).latitude, longitude: routeAt(km).longitude } : {})
  }));
  const draft: CourseHistoryEvent = {
    formatVersion: 1,
    source: "synthetic",
    sourceEventId: ev.id,
    name: `${spec.course} ${ev.id.slice(-4)} (SYNTHETIC)`,
    startTime: ev.start,
    checkpoints,
    efforts: []
  };
  const gpxD = checkpointGpxDistances(draft, plan);
  const P = gpxD.map((x) => planAt(plan, x));
  const start = new Date(ev.start);
  const L = gpxD[gpxD.length - 1]!;

  const efforts: CourseHistoryEffort[] = [];
  for (let r = 0; r < ev.runners; r += 1) {
    const ability = Math.exp(rng.gauss(0, 0.2));
    const ownSlowdown = TRUE_SLOWDOWN + rng.gauss(0, 0.1);
    let t = 0;
    const splits: CourseHistoryEffort["splits"] = [];
    for (let i = 1; i < P.length; i += 1) {
      const mid = (gpxD[i - 1]! + gpxD[i]!) / 2 / L;
      let moving = (P[i]! - P[i - 1]!) * ability * (1 + ownSlowdown * (mid - 0.5)) * Math.exp(rng.gauss(0, 0.07));
      const dark = darkShare(start, t, t + moving, plan.start.latitude, plan.start.longitude);
      moving *= 1 + (TRUE_NIGHT - 1) * dark;
      const arrive = Math.round(t + moving);
      const isAid = i < P.length - 1;
      const stop = isAid ? Math.round(120 * Math.exp(rng.gauss(0, 0.6)) * (1 + mid)) : 0;
      // ~2% of aid splits are missed by timing, as real feeds do.
      if (!isAid || rng.next() > 0.02) {
        splits.push({ checkpointId: checkpoints[i]!.id, inSeconds: arrive, ...(isAid ? { outSeconds: arrive + stop } : {}) });
      }
      t = arrive + stop;
    }
    efforts.push({ splits });
  }
  return { ...draft, efforts };
}

const courses: CourseSpec[] = [
  {
    course: "synthetic-50k",
    gpxFile: "../pacing/course-50k-with-aids.gpx",
    gpxXml: readFileSync(resolve(repoRoot, "fixtures/pacing/course-50k-with-aids.gpx"), "utf8"),
    aidKm: [10, 20, 35, 44],
    withLatLon: false,
    events: [
      { id: "synthetic-50k-2025", start: "2025-06-07T13:00:00Z", runners: 40 },
      { id: "synthetic-50k-2026", start: "2026-06-06T13:00:00Z", runners: 40 }
    ]
  },
  {
    course: "synthetic-mountain-100k",
    gpxFile: "synthetic-mountain-100k.gpx",
    gpxXml: syntheticGpx("synthetic-mountain-100k", 46.0, 7.0, 100, 5, 1100),
    aidKm: [12, 25, 40, 55, 70, 85, 94],
    withLatLon: true,
    events: [{ id: "synthetic-mountain-100k-2026", start: "2026-08-28T16:00:00Z", runners: 50 }]
  },
  {
    course: "synthetic-desert-80k",
    gpxFile: "synthetic-desert-80k.gpx",
    gpxXml: syntheticGpx("synthetic-desert-80k", 36.5, -116.8, 80, 2, 500),
    aidKm: [15, 30, 45, 62, 74],
    withLatLon: false,
    events: [{ id: "synthetic-desert-80k-2026", start: "2026-03-14T14:00:00Z", runners: 40 }]
  }
];

mkdirSync(outDir, { recursive: true });
const rng = new SeededRandom(7);
const manifest: Manifest = { courses: [] };
for (const spec of courses) {
  if (!spec.gpxFile.startsWith("../")) {
    writeFileSync(resolve(outDir, spec.gpxFile), spec.gpxXml);
  }
  const files: string[] = [];
  for (const ev of spec.events) {
    const file = `${ev.id}.json`;
    writeFileSync(resolve(outDir, file), `${JSON.stringify(makeEvent(spec, ev, rng))}\n`);
    files.push(file);
  }
  manifest.courses.push({ course: spec.course, gpx: spec.gpxFile, events: files });
}
writeFileSync(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`wrote ${outDir}\n`);
