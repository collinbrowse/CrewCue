/**
 * Projection backtest (plan PR 2).
 *
 *   npm run projection:backtest                          # headline report on the local data folder
 *   npm run projection:backtest -- --fixture             # the committed SYNTHETIC fixture
 *   npm run projection:backtest -- --analysis all        # every ported reference analysis
 *   npm run projection:backtest -- --fixture --check     # CI: run everything, check parity, exit 1 on failure
 *
 * Options: --data <dir> (default services/api/projection-backtest-data, git-ignored),
 * --analysis <name[,name]|all>, --sigma <plan σ, default 0.12>, --seed <n>, --slowdown <loco|number>.
 * Analyses: headline, gpx-backtest, gpx-fade, night, prior-sweep, fresh-look, fresh-look-2,
 * fresh-look-3, history-size, windows. See README.md for the data folder layout and the data rules.
 * --write-windows --windows-source "<dataset, permission, date>": fit the arrival-window table on
 * the data and write src/lib/arrivalWindowTable.ts (refused for the synthetic fixture).
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ANALYSES, type AnalysisName } from "./analyses.js";
import { loadBacktestData } from "./data.js";
import { checkServerParity } from "./parity.js";
import { fitWindowTable, writeWindowTable } from "./windows.js";
import { anchored, biasLayer, ratio, score } from "./score.js";
import { trustFromPlanSigma } from "./formulas.js";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "../..");
const FIXTURE_DIR = resolve(apiRoot, "../../fixtures/projection-backtest");
const DEFAULT_DATA_DIR = resolve(apiRoot, "projection-backtest-data");

const { values } = parseArgs({
  options: {
    data: { type: "string" },
    fixture: { type: "boolean", default: false },
    analysis: { type: "string", default: "headline" },
    sigma: { type: "string", default: "0.12" },
    seed: { type: "string" },
    slowdown: { type: "string", default: "loco" },
    check: { type: "boolean", default: false },
    "write-windows": { type: "boolean", default: false },
    "windows-source": { type: "string" }
  }
});

const dataDir = values.fixture ? FIXTURE_DIR : resolve(values.data ?? DEFAULT_DATA_DIR);
if (!existsSync(resolve(dataDir, "manifest.json"))) {
  process.stderr.write(
    `No manifest.json in ${dataDir}.\nPut split-format events there (see scripts/projection-backtest/README.md) or pass --fixture.\n`
  );
  process.exit(1);
}

const names: AnalysisName[] =
  values.check || values.analysis === "all"
    ? (Object.keys(ANALYSES) as AnalysisName[])
    : (values.analysis!.split(",").map((s) => s.trim()) as AnalysisName[]);
const unknown = names.filter((n) => !(n in ANALYSES));
if (unknown.length > 0) {
  process.stderr.write(`Unknown analysis: ${unknown.join(", ")}. Known: ${Object.keys(ANALYSES).join(", ")}\n`);
  process.exit(1);
}

const slowdown = values.slowdown === "loco" ? "loco" : Number(values.slowdown);
const data = loadBacktestData(dataDir, {
  planSigma: Number(values.sigma),
  slowdown,
  ...(values.seed !== undefined ? { seed: Number(values.seed) } : {})
});
process.stdout.write(`data: ${dataDir}\n`);
for (const name of names) {
  process.stdout.write(`\n${"=".repeat(100)}\n${name}\n${"=".repeat(100)}\n`);
  ANALYSES[name](data);
}

if (values["write-windows"]) {
  // Never write a table fit on data CrewCue may not use (see README "Data rules").
  if (values.fixture || !values["windows-source"]) {
    process.stderr.write("--write-windows needs --windows-source \"<dataset and permission>\" and real (not fixture) data.\n");
    process.exit(1);
  }
  const fit = fitWindowTable(data, values["windows-source"]!);
  writeWindowTable(resolve(apiRoot, "src/lib/arrivalWindowTable.ts"), fit.table);
  process.stdout.write(`\nwrote ${fit.table.bands.length} window bands to src/lib/arrivalWindowTable.ts\n`);
}

if (values.check) {
  const problems: string[] = [];
  if (data.efforts.length === 0) {
    problems.push("no complete finishers loaded");
  }
  const trust = trustFromPlanSigma(data.planSigma);
  for (const [label, fn] of [
    ["server", anchored("gpx")],
    ["B0", ratio("gpxFade")],
    ["PR 3", biasLayer(data, "gpxFade", () => trust).fn]
  ] as const) {
    const s = score(fn, data.efforts);
    if (!Number.isFinite(s.finish) || !Number.isFinite(s.nextAid)) {
      problems.push(`${label}: non-finite score (finish ${s.finish}, next aid ${s.nextAid})`);
    }
  }
  for (const mode of ["today", "tuned"] as const) {
    const parity = checkServerParity(data, 5, mode);
    process.stdout.write(
      `\nparity (${mode}) with production recomputeRaceProjection: ${parity.compared} finish ETAs, max diff ${parity.maxDiffSeconds.toFixed(3)} s\n`
    );
    if (parity.compared === 0) {
      problems.push(`parity (${mode}): nothing compared`);
    }
    problems.push(...parity.failures.slice(0, 10));
  }
  if (problems.length > 0) {
    process.stderr.write(`\nprojection backtest check FAILED:\n  ${problems.join("\n  ")}\n`);
    process.exit(1);
  }
  process.stdout.write("projection backtest check passed\n");
}
