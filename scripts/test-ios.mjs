#!/usr/bin/env node
/**
 * Run the iOS UI smoke tests (every feature deeplink in clients/behavior/deeplinks.json) on an available iPhone simulator.
 * Set CREWCUE_IOS_SIMULATOR to pin a device name.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") {
  console.log("test:ios skipped (not macOS)");
  process.exit(0);
}

function pickDestination() {
  if (process.env.CREWCUE_IOS_SIMULATOR) {
    console.log(`test:ios: ${process.env.CREWCUE_IOS_SIMULATOR}`);
    return `platform=iOS Simulator,name=${process.env.CREWCUE_IOS_SIMULATOR}`;
  }
  const listed = spawnSync("xcrun", ["simctl", "list", "devices", "available", "--json"], { encoding: "utf8" });
  if (listed.status !== 0) {
    console.error(listed.stderr || "test:ios: simctl list failed");
    process.exit(1);
  }
  let devicesByRuntime = {};
  try {
    devicesByRuntime = JSON.parse(listed.stdout).devices ?? {};
  } catch {
    console.error("test:ios: simctl did not return JSON");
    process.exit(1);
  }
  const runtimes = Object.entries(devicesByRuntime)
    .filter(([runtime]) => runtime.includes("iOS"))
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }));
  for (const [, devices] of runtimes) {
    const iphone = devices.find((device) => device.isAvailable !== false && device.name?.startsWith("iPhone") && device.udid);
    if (iphone) {
      console.log(`test:ios: ${iphone.name} (${iphone.udid})`);
      return `platform=iOS Simulator,id=${iphone.udid}`;
    }
  }
  console.error("test:ios: no available iPhone simulator. Install one in Xcode > Settings > Components.");
  process.exit(1);
}

const destination = pickDestination();
const evidenceDir = path.join(repoRoot, ".agent-pr-evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
const xcodeArgs = [
  "-project", "apps/ios/CrewCue.xcodeproj",
  "-scheme", "CrewCue",
  "-destination", destination,
  "-resultBundlePath", path.join(evidenceDir, `ios-tests-${Date.now()}.xcresult`),
  "test"
];
// GitHub-hosted macOS has no Apple team. Simulator UI tests ad-hoc sign.
if (process.env.CI) {
  xcodeArgs.push("CODE_SIGN_STYLE=Manual", "CODE_SIGN_IDENTITY=-", "CODE_SIGNING_REQUIRED=NO", "DEVELOPMENT_TEAM=");
}
const result = spawnSync("xcodebuild", xcodeArgs, { cwd: repoRoot, stdio: "inherit" });
process.exit(result.status ?? 1);
