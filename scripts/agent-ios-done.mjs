#!/usr/bin/env node
/**
 * Finish this worktree's iOS device work: shut down its simulators (`CrewCue <worktree>` and its Duo twin)
 * and delete its test result bundles. The build folder stays, so the next run is incremental.
 * Usage: npm run agent:ios:done [-- --delete]   (--delete also deletes the simulators; they are recreated on next use)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { iosSimulatorNames } from "./lib/agentDevice.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deleteSims = process.argv.includes("--delete");

if (process.platform !== "darwin") {
  console.log("agent-ios-done: skipped (not macOS)");
  process.exit(0);
}

const listed = spawnSync("xcrun", ["simctl", "list", "devices", "--json"], { encoding: "utf8" });
const devices = listed.status === 0 ? Object.values(JSON.parse(listed.stdout).devices ?? {}).flat() : [];
const names = new Set(iosSimulatorNames(repoRoot));

for (const device of devices.filter((d) => names.has(d.name))) {
  if (device.state === "Booted") spawnSync("xcrun", ["simctl", "shutdown", device.udid], { stdio: "ignore" });
  if (deleteSims) spawnSync("xcrun", ["simctl", "delete", device.udid], { stdio: "ignore" });
  console.log(`agent-ios-done: ${deleteSims ? "deleted" : "shut down"} ${device.name}`);
}

const evidence = path.join(repoRoot, ".agent-pr-evidence");
let removed = 0;
for (const entry of fs.existsSync(evidence) ? fs.readdirSync(evidence) : []) {
  if (!entry.endsWith(".xcresult")) continue;
  fs.rmSync(path.join(evidence, entry), { recursive: true, force: true });
  removed++;
}
if (removed) console.log(`agent-ios-done: deleted ${removed} .xcresult bundle(s)`);
