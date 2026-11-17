#!/usr/bin/env node
/**
 * Cold-launch the iOS app N times on a simulator and fail if any launch dies.
 * Catches launch-time crashes that one launch can miss, like the launch-splash trap on iOS 27:
 * SwiftUI's async renderer re-ran the window's main-actor closure off the main thread when the
 * splash ended over a screen that was animating.
 *
 *   npm run test:ios:launch-loop -- [--runs 20] [--udid <udid>] [--app <CrewCue.app>] [--hold 8] [-- <app args>]
 *
 * Defaults: this checkout's simulator (scripts/lib/agentDevice.mjs), the app agent:ios:ready
 * last built, 20 runs, 8 s per launch (the splash takes about 2 s), and no app arguments:
 * a plain launch, so the splash plays. To end the splash over the race-day replay, which is what
 * exposed that trap, pass `-- --signed-out --deeplink crewcue://dev/onboarding-race-preview --launch-splash`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureIosSimulator } from "./lib/agentDevice.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_ID = "com.crewcue.ios";
const REPORTS = path.join(os.homedir(), "Library/Logs/DiagnosticReports");

function parseArgs(argv) {
  const options = { runs: 20, hold: 8, udid: undefined, app: undefined, appArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      options.appArgs = argv.slice(i + 1);
      break;
    }
    if (arg === "--runs") options.runs = Number(argv[++i]);
    else if (arg === "--hold") options.hold = Number(argv[++i]);
    else if (arg === "--udid") options.udid = argv[++i];
    else if (arg === "--app") options.app = argv[++i];
    else throw new Error(`ios-launch-loop: unknown argument ${arg}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error("ios-launch-loop: --runs must be a positive integer");
  if (!(options.hold > 0)) throw new Error("ios-launch-loop: --hold must be positive seconds");
  return options;
}

function simctl(args, { allowFail = false } = {}) {
  const result = spawnSync("xcrun", ["simctl", ...args], { encoding: "utf8" });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`simctl ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function defaultApp() {
  const products = path.join(repoRoot, ".agent-pr-evidence/ios-derived/Build/Products");
  if (!fs.existsSync(products)) return undefined;
  for (const dir of fs.readdirSync(products)) {
    const app = path.join(products, dir, "CrewCue.app");
    if (dir.endsWith("-iphonesimulator") && fs.existsSync(app)) return app;
  }
  return undefined;
}

/** CrewCue crash reports written since `sinceMs`, keyed by the crashed pid. */
function crashReports(sinceMs) {
  const byPid = new Map();
  if (!fs.existsSync(REPORTS)) return byPid;
  for (const name of fs.readdirSync(REPORTS)) {
    if (!name.startsWith("CrewCue-") || !name.endsWith(".ips")) continue;
    const file = path.join(REPORTS, name);
    if (fs.statSync(file).mtimeMs < sinceMs) continue;
    try {
      // An .ips file is a one-line JSON header, then the JSON report.
      const text = fs.readFileSync(file, "utf8");
      const report = JSON.parse(text.slice(text.indexOf("\n") + 1));
      const thread = report.threads?.[report.faultingThread];
      const frames = (thread?.frames ?? []).map((frame) => frame.symbol).filter(Boolean);
      const appFrame = frames.find((symbol) => /CrewCue|closure|body/.test(symbol)) ?? frames[0];
      byPid.set(report.pid, `${name}: ${report.exception?.type ?? "?"} on ${thread?.name ?? "?"} in ${appFrame ?? "?"}`);
    } catch {
      // A report still being written; the next scan reads it.
    }
  }
  return byPid;
}

/** How the simulator saw `pid` exit, e.g. "SIGTRAP(5)". Crash reports can land minutes later. */
function exitSignal(udid, pid) {
  const shown = simctl(
    ["spawn", udid, "log", "show", "--last", "2m", "--style", "compact", "--predicate",
      `eventMessage CONTAINS "${BUNDLE_ID}>:${pid}] Process exited"`],
    { allowFail: true }
  );
  return shown.stdout.match(/code:(SIG[A-Z]+\(\d+\)|\d+)/)?.[1];
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const options = parseArgs(process.argv.slice(2));
const udid = options.udid ?? ensureIosSimulator(repoRoot, "iPhone 18 Pro").udid;
simctl(["boot", udid], { allowFail: true });
simctl(["bootstatus", udid, "-b"]);
const app = options.app ?? defaultApp();
if (app) {
  simctl(["install", udid, app]);
} else if (simctl(["get_app_container", udid, BUNDLE_ID], { allowFail: true }).status !== 0) {
  throw new Error("ios-launch-loop: no CrewCue.app installed. Run npm run agent:ios:ready first, or pass --app.");
}

const shownArgs = options.appArgs.join(" ").replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "<jwt>");
console.log(`ios-launch-loop: ${options.runs} launches on ${udid}, ${options.hold}s each, args: ${shownArgs || "(none, splash plays)"}`);
const startedAt = Date.now();
const failures = [];
for (let run = 1; run <= options.runs; run++) {
  const launched = simctl(["launch", "--terminate-running-process", udid, BUNDLE_ID, ...options.appArgs], { allowFail: true });
  const pid = Number(launched.stdout.match(/:\s*(\d+)\s*$/m)?.[1]);
  if (launched.status !== 0 || !pid) {
    failures.push({ run, pid: undefined, reason: `launch failed: ${(launched.stderr || launched.stdout).trim()}` });
    console.log(`  run ${run}: launch failed`);
    continue;
  }
  const deadline = Date.now() + options.hold * 1000;
  while (Date.now() < deadline && alive(pid)) sleep(250);
  if (alive(pid)) {
    console.log(`  run ${run}: ok (pid ${pid})`);
    continue;
  }
  const reason = `exited ${exitSignal(udid, pid) ?? "(signal unknown)"}`;
  failures.push({ run, pid, reason });
  console.log(`  run ${run}: DIED, pid ${pid} ${reason}`);
}
simctl(["terminate", udid, BUNDLE_ID], { allowFail: true });

console.log(`ios-launch-loop: ${options.runs - failures.length}/${options.runs} launches survived ${options.hold}s`);
if (failures.length) {
  // Give late crash reports a moment, then name the ones that have landed.
  sleep(5000);
  const reports = crashReports(startedAt);
  for (const failure of failures) {
    if (failure.pid && reports.has(failure.pid)) console.log(`  run ${failure.run}: ${reports.get(failure.pid)}`);
  }
  console.log(`ios-launch-loop: reports for the rest may still land in ${REPORTS}`);
}
process.exit(failures.length ? 1 : 0);
