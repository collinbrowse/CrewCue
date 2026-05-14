#!/usr/bin/env node
/**
 * Run `pod install` in apps/mobile/ios.
 *
 * On Apple Silicon, if Node is x86_64 (Homebrew /usr/local or Rosetta), the
 * default `pod` invocation loads Ruby as x86_64 while gems like `ffi` are
 * often built for arm64 → LoadError. Wrapping with `arch -arm64` fixes that.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const iosDir = path.join(repoRoot, "apps", "mobile", "ios");
const xcodeEnvLocal = path.join(iosDir, ".xcode.env.local");

if (existsSync(xcodeEnvLocal)) {
  try {
    const txt = readFileSync(xcodeEnvLocal, "utf8");
    if (/\/usr\/local\/(Cellar|opt)\/node/.test(txt)) {
      unlinkSync(xcodeEnvLocal);
      console.warn(
        "ios-pod-install: removed stale .xcode.env.local (referenced old /usr/local Node). Recreate only if you need a custom NODE_BINARY."
      );
    }
  } catch {
    /* ignore */
  }
}

const extraArgs = process.argv.slice(2);
const podArgs = ["install", ...extraArgs];

const isDarwin = process.platform === "darwin";
const isAppleSilicon = isDarwin && os.machine() === "arm64";
const isRosettaNode = isAppleSilicon && process.arch === "x64";

function runPod() {
  if (isRosettaNode) {
    return spawnSync("arch", ["-arm64", "pod", ...podArgs], {
      cwd: iosDir,
      stdio: "inherit",
      env: process.env
    });
  }
  return spawnSync("pod", podArgs, {
    cwd: iosDir,
    stdio: "inherit",
    env: process.env
  });
}

const require = createRequire(import.meta.url);
try {
  require.resolve("expo/package.json");
} catch {
  console.error("ios-pod-install: run from repo root after npm install.");
  process.exit(1);
}

const result = runPod();
process.exit(result.status === null ? 1 : result.status);
