#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { derivedDataArgs, IOS_PROJECT, IOS_SCHEME, prepareSharedPackages, xcodebuildCommand } from "./lib/iosBuild.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") {
  console.log("verify:ios skipped (not macOS)");
  process.exit(0);
}
let packagesArgs;
try {
  packagesArgs = prepareSharedPackages(repoRoot);
} catch (error) {
  console.error(`verify:ios: ${error.message}`);
  process.exit(1);
}
const job = xcodebuildCommand(
  ["-project", IOS_PROJECT, "-scheme", IOS_SCHEME, "-destination", "generic/platform=iOS Simulator", ...derivedDataArgs(repoRoot), ...packagesArgs, "build"],
  "CrewCue iOS build check"
);
const result = spawnSync(job.command, job.args, { cwd: repoRoot, stdio: "inherit" });
process.exit(result.status ?? 1);
