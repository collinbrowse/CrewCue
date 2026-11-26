#!/usr/bin/env node
/**
 * Decides which device jobs (ios, android) a CI run needs, from the files that changed.
 *
 *   node scripts/ci-changed-areas.mjs --base <sha> [--head <ref>]
 *
 * ci.yml passes the base: a PR's target tip, or on main the commit of the last green CI run, so a
 * change whose own run failed, was cancelled or was skipped is tested by the next run.
 * With no usable base, every area runs. Writes `ios=true|false` and `android=true|false` to
 * $GITHUB_OUTPUT when it is set, and always prints them.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** A trailing slash matches everything under the folder; anything else is one exact file. */
const SHARED = [
  "packages/client-core/",
  "clients/behavior/",
  ".github/workflows/ci.yml",
  "scripts/ci-changed-areas.mjs"
];

export const AREAS = {
  ios: [
    ...SHARED,
    "apps/ios/",
    "scripts/test-ios.mjs",
    "scripts/lib/iosBuild.mjs",
    "scripts/lib/agentDevice.mjs"
  ],
  android: [
    ...SHARED,
    "apps/android/",
    "scripts/build-swift-android.mjs",
    "scripts/verify-client-core-android-build.mjs",
    "scripts/install-swift-android-sdk.sh",
    "scripts/lib/swiftAndroidToolchain.mjs",
    ".github/actions/setup-swift/"
  ]
};

function touches(patterns, file) {
  return patterns.some((pattern) => (pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern));
}

/** @param {string[] | null} files changed files, or null when they are unknown (then every area runs) */
export function areasFor(files) {
  const result = {};
  for (const [area, patterns] of Object.entries(AREAS)) {
    result[area] = files === null || files.some((file) => touches(patterns, file));
  }
  return result;
}

/** Files that differ between two commits, or null when git cannot say. */
export function changedFiles(base, head = "HEAD", cwd = process.cwd()) {
  if (!base) return null;
  const diff = spawnSync("git", ["diff", "--name-only", "--no-renames", base, head], { cwd, encoding: "utf8" });
  if (diff.status !== 0) return null;
  return diff.stdout.split("\n").filter(Boolean);
}

function option(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

function main(argv) {
  const base = option(argv, "--base");
  const head = option(argv, "--head") || "HEAD";
  const files = changedFiles(base, head);
  const areas = areasFor(files);
  console.log(
    files === null
      ? `ci-changed-areas: no usable base (${base || "none given"}), running every area`
      : `ci-changed-areas: ${files.length} file(s) changed since ${base}`
  );
  const lines = Object.entries(areas).map(([area, run]) => `${area}=${run}`);
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
