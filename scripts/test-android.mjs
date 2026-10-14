#!/usr/bin/env node
/**
 * Run the Android instrumented smoke tests (every passing deeplink in clients/behavior/deeplinks.json)
 * on the connected emulator or device. Start one first, e.g. `npm run agent:android:ready`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { androidSdkEnv, androidSdkRoot } from "./lib/androidSdkEnv.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!fs.existsSync(path.join(androidSdkRoot(), "platforms"))) {
  console.error("test:android: Android SDK not found. Set ANDROID_HOME.");
  process.exit(1);
}
const result = spawnSync(
  path.join(repoRoot, "apps/android/gradlew"),
  ["-p", path.join(repoRoot, "apps/android"), ":app:connectedDebugAndroidTest"],
  { stdio: "inherit", env: androidSdkEnv() }
);
process.exit(result.status ?? 1);
