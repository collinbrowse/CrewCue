#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") {
  console.log("verify:ios skipped (not macOS)");
  process.exit(0);
}
const result = spawnSync(
  "xcodebuild",
  ["-project", "apps/ios/CrewCue.xcodeproj", "-scheme", "CrewCue", "-destination", "generic/platform=iOS Simulator", "build"],
  { cwd: repoRoot, stdio: "inherit" }
);
process.exit(result.status ?? 1);
