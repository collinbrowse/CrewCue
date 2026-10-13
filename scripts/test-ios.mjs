#!/usr/bin/env node
/**
 * Run the iOS UI smoke tests (every passing deeplink in clients/behavior/deeplinks.json) on an available iPhone simulator.
 * Set CREWCUE_IOS_SIMULATOR to pin a device name.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") {
  console.log("test:ios skipped (not macOS)");
  process.exit(0);
}

function pickSimulator() {
  if (process.env.CREWCUE_IOS_SIMULATOR) return process.env.CREWCUE_IOS_SIMULATOR;
  const listed = spawnSync("xcrun", ["simctl", "list", "devices", "available", "--json"], { encoding: "utf8" });
  const runtimes = Object.entries(JSON.parse(listed.stdout).devices)
    .filter(([runtime]) => runtime.includes("iOS"))
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }));
  for (const [, devices] of runtimes) {
    const iphone = devices.find((device) => device.name.startsWith("iPhone"));
    if (iphone) return iphone.name;
  }
  console.error("test:ios: no available iPhone simulator. Install one in Xcode > Settings > Components.");
  process.exit(1);
}

const simulator = pickSimulator();
console.log(`test:ios: ${simulator}`);
const result = spawnSync(
  "xcodebuild",
  [
    "-project", "apps/ios/CrewCue.xcodeproj",
    "-scheme", "CrewCue",
    "-destination", `platform=iOS Simulator,name=${simulator}`,
    "-resultBundlePath", path.join(repoRoot, ".agent-pr-evidence", `ios-tests-${Date.now()}.xcresult`),
    "test"
  ],
  { cwd: repoRoot, stdio: "inherit" }
);
process.exit(result.status ?? 1);
