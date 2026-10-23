/**
 * Regenerate fixtures/pacing/estimate-bands.json golden values from the current estimator.
 *
 * Usage (from services/api):
 *   npx tsx scripts/regen-estimate-bands.ts
 *
 * The golden bands fixture pins the deterministic estimator output (id + finish + bands). Run this
 * after an intentional model change (e.g. PR C, #483) so EC1/EC2 in pacingEstimateBands.test.ts
 * re-baseline against the new coherent model. Mirrors the test's estimateMicro() inputs exactly.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseActivityHistoryRef, type ActivityHistoryRef } from "@crewcue/contracts";
import { flattenWorkspaceGeometry } from "@crewcue/map-core";
import {
  DEFAULT_PACING_ESTIMATE_SEED,
  estimatePacingMicroModelWithArtifacts
} from "../src/lib/pacingEstimate/index.js";
import { load50kCourseWithAids } from "../src/lib/testCourseRouteLayer.js";

const RACE_START = "2026-08-15T13:00:00.000Z";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "estimate-bands.json"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found");
}

const pacingDir = findPacingFixturesDir();

function routeMetricPointsFor50k() {
  const { routeOverlayLayer } = load50kCourseWithAids();
  return flattenWorkspaceGeometry(routeOverlayLayer.geometry).map((coord) => {
    const t = coord as [number, number, number?];
    return { longitude: t[0], latitude: t[1], elevationMeters: typeof t[2] === "number" ? t[2] : null };
  });
}

function estimateMicro(history: ActivityHistoryRef[]) {
  const { checkpoints } = load50kCourseWithAids();
  return estimatePacingMicroModelWithArtifacts({
    raceStartAt: RACE_START,
    checkpoints,
    history,
    seed: DEFAULT_PACING_ESTIMATE_SEED,
    routeMetricPoints: routeMetricPointsFor50k(),
    courseLengthMeters: checkpoints[checkpoints.length - 1]?.distanceMetersFromStart
  }).estimate;
}

function fixtureLongHistory(): ActivityHistoryRef {
  const pack = JSON.parse(readFileSync(resolve(pacingDir, "schedule-expected.json"), "utf8")) as {
    historyRefs: unknown[];
  };
  return parseActivityHistoryRef(pack.historyRefs[0]);
}

const historyBackedEstimate = estimateMicro([fixtureLongHistory()]);
const coldStartEstimate = estimateMicro([]);

const fixturePath = resolve(pacingDir, "estimate-bands.json");
const current = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;

const next = {
  ...current,
  historyBacked: {
    id: historyBackedEstimate.id,
    coldStart: historyBackedEstimate.coldStart,
    expectedFinishAt: historyBackedEstimate.expectedFinishAt,
    expectedFinishElapsedSeconds: historyBackedEstimate.expectedFinishElapsedSeconds,
    bands: historyBackedEstimate.bands,
    historyRefIds: historyBackedEstimate.historyRefIds
  },
  coldStart: {
    id: coldStartEstimate.id,
    coldStart: coldStartEstimate.coldStart,
    expectedFinishAt: coldStartEstimate.expectedFinishAt,
    expectedFinishElapsedSeconds: coldStartEstimate.expectedFinishElapsedSeconds,
    bands: coldStartEstimate.bands
  }
};

writeFileSync(fixturePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`Wrote ${fixturePath}`);
console.log(
  `historyBacked: ${historyBackedEstimate.id} finish=${historyBackedEstimate.expectedFinishElapsedSeconds}s`
);
console.log(`coldStart: ${coldStartEstimate.id} finish=${coldStartEstimate.expectedFinishElapsedSeconds}s`);
