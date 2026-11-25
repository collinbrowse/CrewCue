#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { androidSdkEnv, androidSdkRoot } from "./lib/androidSdkEnv.mjs";
import { slotted } from "./lib/slot.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = process.env.CREWCUE_REQUIRE_ANDROID_BUILD === "1";
const sdk = androidSdkRoot();
if (!fs.existsSync(path.join(sdk, "platforms"))) {
  const message = "Android SDK platforms not found. Set ANDROID_HOME to assemble the debug APK.";
  if (required) {
    console.error(message);
    process.exit(1);
  }
  console.log(`verify:android skipped (${message})`);
  process.exit(0);
}
const gradle = fs.existsSync(path.join(repoRoot, "apps/android/gradlew")) ? path.join(repoRoot, "apps/android/gradlew") : "gradle";
const job = slotted(gradle, ["-p", path.join(repoRoot, "apps/android"), ":app:assembleDebug"], { label: "CrewCue Android build check", kind: "gradle assembleDebug" });
const result = spawnSync(job.command, job.args, {
  stdio: "inherit",
  env: androidSdkEnv()
});
process.exit(result.status ?? 1);
