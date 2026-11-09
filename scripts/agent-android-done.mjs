#!/usr/bin/env node
/**
 * Finish this worktree's Android turn: stop its emulator and free the machine-wide lock
 * so the next worktree can run Android. Safe to run when you never had the turn.
 * Usage: npm run agent:android:done
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { androidSdkEnv } from "./lib/androidSdkEnv.mjs";
import { androidSerial, readAndroidLock, releaseAndroid } from "./lib/agentDevice.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serial = androidSerial(repoRoot);
spawnSync("adb", ["-s", serial, "emu", "kill"], { env: androidSdkEnv(), stdio: "ignore" });
if (releaseAndroid(repoRoot)) {
  console.log(`agent-android-done: stopped ${serial} and freed the Android turn`);
} else {
  const owner = readAndroidLock();
  console.log(`agent-android-done: this worktree did not hold the Android turn${owner ? ` (${owner.checkout} does)` : ""}`);
}
