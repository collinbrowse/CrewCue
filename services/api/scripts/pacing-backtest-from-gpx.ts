/**
 * Interactive GPX pacing backtest.
 *
 * Usage (from repo root):
 *   npm run pacing:backtest:gpx -w @crewcue/api
 *
 * Prompts for:
 *   1) course GPX (route + aid waypoints)
 *   2) race GPX (the finished effort; must have point timestamps)
 *   3) training GPX files, one per prompt, until you press Enter on an empty line (or type done)
 *
 * Prints predicted vs actual moving elapsed. Time near an aid (75 m) while slower than
 * ~30 min/mi (or stopped) is stoppage and is not scored as moving.
 *
 * Deterministic estimator; no HTTP. Does not write fixture files.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPacingBacktest } from "../src/lib/pacingEstimate/backtest.js";
import { buildBacktestScenarioFromGpx, GpxBacktestError } from "../src/lib/pacingEstimate/backtestFromGpx.js";
import { printPacingBacktestResult } from "./pacing-backtest-print.js";

const HELP = `Interactive GPX pacing backtest.

Usage:
  npm run pacing:backtest:gpx -w @crewcue/api

You will be asked for:
  - Course GPX: the race route with aid waypoints
  - Race GPX: your finished effort (track points must include timestamps)
  - Training GPX: prior activities, one path per line. Empty line or "done" finishes.

Stoppage (excluded from moving time): within 75 m of an aid AND slower than ~30 min/mi
(or not moving). Both must be true.

The command prints a predicted-vs-actual table. It does not write files.
`;

function printHelp(): void {
  process.stdout.write(HELP);
}

async function promptPath(rl: ReturnType<typeof createInterface>, question: string, required: boolean): Promise<string> {
  const answer = (await rl.question(question)).trim();
  if (!answer) {
    if (required) {
      throw new Error("A file path is required.");
    }
    return "";
  }
  if (/^(done|q|quit)$/i.test(answer)) {
    return "";
  }
  return resolve(answer.replace(/^['"]|['"]$/g, ""));
}

function readGpx(path: string, kind: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`Could not read ${kind} GPX at ${path}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const rl = createInterface({ input, output });
  try {
    process.stdout.write(HELP.split("Usage:")[0] ?? "");
    const coursePath = await promptPath(rl, "Course GPX path: ", true);
    const racePath = await promptPath(rl, "Race GPX path (timed activity): ", true);
    const trainingXmls: string[] = [];
    for (;;) {
      const histPath = await promptPath(
        rl,
        "Training GPX path (Enter or 'done' when finished): ",
        false
      );
      if (!histPath) {
        break;
      }
      trainingXmls.push(readGpx(histPath, "training"));
    }

    const scenario = buildBacktestScenarioFromGpx({
      name: `${coursePath} × ${racePath}`,
      courseGpxXml: readGpx(coursePath, "course"),
      raceGpxXml: readGpx(racePath, "race"),
      trainingGpxXmls
    });
    printPacingBacktestResult(runPacingBacktest(scenario));
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  const message =
    error instanceof GpxBacktestError || error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
