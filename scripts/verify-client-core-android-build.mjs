#!/usr/bin/env node
/**
 * Cross-compile client-core for the Android Swift SDK.
 * Skips with exit 0 unless CREWCUE_REQUIRE_ANDROID_SWIFT=1 when no SDK is installed.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSwiftForAndroid } from "./lib/swiftAndroid.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const triple = process.env.SWIFT_ANDROID_TRIPLE || "aarch64-unknown-linux-android28";
const required = process.env.CREWCUE_REQUIRE_ANDROID_SWIFT === "1";

const listed = spawnSync("swift", ["sdk", "list"], { encoding: "utf8" });
const text = `${listed.stdout ?? ""}\n${listed.stderr ?? ""}`;
if (listed.status !== 0 || !text.toLowerCase().includes("android")) {
  const message = "Swift Android SDK is not installed. Install the Swift 6.3+ Android artifact bundle, then re-run.";
  if (required) {
    console.error(message);
    process.exit(1);
  }
  console.log(`verify:client-core:android-build skipped (${message})`);
  process.exit(0);
}

const swift = findSwiftForAndroid();
if (!swift) {
  console.error("Install the Swift toolchain matching the Android SDK version (see swift sdk list), or set SWIFT_BIN.");
  process.exit(1);
}
const build = spawnSync(
  swift,
  ["build", "--package-path", path.join(repoRoot, "packages/client-core"), "--build-tests", "--swift-sdk", triple],
  { stdio: "inherit" }
);
process.exit(build.status ?? 1);
