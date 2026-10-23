/**
 * Offline pacing backtest CLI (docs/sdlc/pacing-accuracy-program.md, PR B).
 *
 * Usage (from services/api, deps built):
 *   npm run pacing:backtest                       # runs every fixtures/pacing/backtest-*.json
 *   npm run pacing:backtest -- backtest-50k-example.json other.json
 *
 * Prints predicted vs actual moving elapsed per aid and at the finish, with signed error and MAE.
 * Deterministic; no HTTP, no database. Seed real scenarios from completed efforts (Railway is the
 * source of real data). A scenario file is JSON:
 *   { name, raceStartAt, courseGpx (filename in fixtures/pacing), history[], actualSplits[], seed? }
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPacingBacktest, type BacktestScenario, type BacktestResult } from "../src/lib/pacingEstimate/backtest.js";

type ScenarioFile = Omit<BacktestScenario, "courseGpxXml"> & { courseGpx: string };

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "course-50k-with-aids.gpx"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found (looked up the directory tree)");
}

function formatHms(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const s = Math.abs(Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatSignedHms(seconds: number | null): string {
  if (seconds === null) {
    return "     —   ";
  }
  return `${seconds >= 0 ? "+" : ""}${formatHms(seconds)}`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function loadScenario(fixturesDir: string, fileName: string): BacktestScenario {
  const raw = JSON.parse(readFileSync(resolve(fixturesDir, fileName), "utf8")) as ScenarioFile;
  const courseGpxXml = readFileSync(resolve(fixturesDir, raw.courseGpx), "utf8");
  return {
    name: raw.name,
    raceStartAt: raw.raceStartAt,
    courseGpxXml,
    history: raw.history,
    actualSplits: raw.actualSplits,
    ...(raw.seed !== undefined ? { seed: raw.seed } : {})
  };
}

function printResult(result: BacktestResult): void {
  process.stdout.write(`\n=== ${result.name} ===\n`);
  process.stdout.write(
    `course ${(result.courseLengthMeters / 1000).toFixed(2)} km · ${result.coldStart ? "COLD START" : "history-backed"}\n`
  );
  process.stdout.write(`${result.explanation}\n\n`);
  process.stdout.write(
    `${pad("Checkpoint", 16)}${pad("Dist(km)", 10)}${pad("Predicted", 12)}${pad("Actual", 12)}${pad("SignedErr", 12)}\n`
  );
  for (const row of result.rows) {
    process.stdout.write(
      pad(row.label, 16) +
        pad((row.distanceMetersFromStart / 1000).toFixed(2), 10) +
        pad(formatHms(row.predictedElapsedSeconds), 12) +
        pad(row.actualElapsedSeconds === null ? "—" : formatHms(row.actualElapsedSeconds), 12) +
        pad(formatSignedHms(row.signedErrorSeconds), 12) +
        "\n"
    );
  }
  process.stdout.write(
    `\nFinish predicted ${formatHms(result.finishPredictedElapsedSeconds)} · ` +
      `actual ${result.finishActualElapsedSeconds === null ? "—" : formatHms(result.finishActualElapsedSeconds)} · ` +
      `signed error ${formatSignedHms(result.finishSignedErrorSeconds)}\n`
  );
  process.stdout.write(
    `MAE ${formatHms(result.meanAbsoluteErrorSeconds)} over ${result.scoredRowCount} scored checkpoint(s)\n`
  );
}

function main(): void {
  const fixturesDir = findPacingFixturesDir();
  const requested = process.argv.slice(2);
  const files =
    requested.length > 0
      ? requested
      : readdirSync(fixturesDir)
          .filter((name) => name.startsWith("backtest-") && name.endsWith(".json"))
          .sort();
  if (files.length === 0) {
    process.stderr.write("No backtest scenarios found (fixtures/pacing/backtest-*.json).\n");
    process.exit(1);
  }
  for (const fileName of files) {
    const scenario = loadScenario(fixturesDir, fileName);
    printResult(runPacingBacktest(scenario));
  }
}

main();
