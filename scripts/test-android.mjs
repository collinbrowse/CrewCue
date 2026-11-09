#!/usr/bin/env node
/**
 * Run the Android instrumented smoke tests (every feature deeplink in clients/behavior/deeplinks.json)
 * on this checkout's emulator (scripts/lib/agentDevice.mjs). Start it first: `npm run agent:android:ready`.
 * ANDROID_SERIAL picks another device; CI or CREWCUE_SHARED_DEVICE=1 uses whatever is connected.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { androidSdkEnv, androidSdkRoot } from "./lib/androidSdkEnv.mjs";
import { androidSerial, sharedDevice, tryAcquireAndroid } from "./lib/agentDevice.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!fs.existsSync(path.join(androidSdkRoot(), "platforms"))) {
  console.error("test:android: Android SDK not found. Set ANDROID_HOME.");
  process.exit(1);
}
const env = androidSdkEnv();
if (!env.ANDROID_SERIAL && !sharedDevice()) {
  const turn = tryAcquireAndroid(repoRoot);
  if (!turn.acquired) {
    console.error(`test:android: Android is in use by ${turn.owner?.checkout}. Retry later; never use its emulator.`);
    process.exit(1);
  }
  env.ANDROID_SERIAL = androidSerial(repoRoot);
  const devices = spawnSync("adb", ["devices"], { encoding: "utf8", env }).stdout ?? "";
  if (!devices.split("\n").some((line) => line.trim().startsWith(`${env.ANDROID_SERIAL}\t`) && line.trim().endsWith("device"))) {
    console.error(`test:android: this checkout's emulator ${env.ANDROID_SERIAL} is not running. Start it with npm run agent:android:ready.`);
    process.exit(1);
  }
}
if (env.ANDROID_SERIAL) console.log(`test:android: ${env.ANDROID_SERIAL}`);
const result = spawnSync(
  path.join(repoRoot, "apps/android/gradlew"),
  ["-p", path.join(repoRoot, "apps/android"), ":app:connectedDebugAndroidTest"],
  { stdio: "inherit", env }
);
process.exit(result.status ?? 1);
