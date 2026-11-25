/**
 * xcodebuild for the iOS app, shared by test:ios and agent:ios:ready.
 *
 * - DerivedData: one folder per checkout (iosDerivedDataDir), so a worktree builds once.
 * - Swift packages: one checkout folder per Package.resolved (sharedSourcePackagesDir). It is
 *   resolved under a lock, so two worktrees never resolve into it at once, and the build then
 *   uses it without resolving again.
 * - Builds go through the machine-wide queue (scripts/lib/slot.mjs) when it is installed.
 * CI keeps xcodebuild's defaults for all three.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { iosDerivedDataDir, packageResolvedKey, sharedSourcePackagesBase, sharedSourcePackagesDir } from "./agentDevice.mjs";
import { BUILD_JOBS, slotted } from "./slot.mjs";

export const IOS_PROJECT = "apps/ios/CrewCue.xcodeproj";
export const IOS_SCHEME = "CrewCue";
const RESOLVE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ios-resolve-packages.mjs");
const LOCKF = "/usr/bin/lockf";

/** Name of the queue lock that guards one shared package folder. */
export function packagesLockName(repoRoot) {
  return `spm-crewcue-${packageResolvedKey(repoRoot)}`;
}

/**
 * Resolves Swift packages into this checkout's shared folder, one resolver at a time, and returns
 * the xcodebuild arguments that build against it. Returns [] in CI. Throws if resolution fails.
 */
export function prepareSharedPackages(repoRoot, env = process.env) {
  const base = sharedSourcePackagesBase(env);
  const dir = sharedSourcePackagesDir(repoRoot, env);
  if (!base || !dir) return [];
  fs.mkdirSync(base, { recursive: true });
  const key = path.basename(dir);
  // Two locks: the queue lock shows the wait in `slot status`; lockf also holds when this already
  // runs inside a queued job (nested `slot run` skips its locks) or slot isn't installed.
  let inner = [process.execPath, RESOLVE_SCRIPT, repoRoot, dir];
  if (fs.existsSync(LOCKF)) inner = [LOCKF, "-k", path.join(base, `.${key}.lock`), ...inner];
  const job = slotted(inner[0], inner.slice(1), { credits: 1, locks: [packagesLockName(repoRoot)], label: "CrewCue Swift packages", kind: "xcodebuild resolve" }, env);
  const result = spawnSync(job.command, job.args, { cwd: repoRoot, stdio: ["ignore", "inherit", "inherit"], env });
  if (result.status !== 0) throw new Error(`Swift package resolution into ${dir} failed (exit ${result.status ?? result.signal}).`);
  return ["-clonedSourcePackagesDirPath", dir, "-disableAutomaticPackageResolution"];
}

/** xcodebuild arguments for this checkout's DerivedData folder ([] in CI). */
export function derivedDataArgs(repoRoot, env = process.env) {
  const dir = iosDerivedDataDir(repoRoot, env);
  return dir ? ["-derivedDataPath", dir] : [];
}

/**
 * The xcodebuild command for `args`, queued at BUILD_JOBS credits with `-jobs BUILD_JOBS` when
 * the queue is installed.
 */
export function xcodebuildCommand(args, label, env = process.env) {
  const job = slotted("xcodebuild", ["-jobs", String(BUILD_JOBS), ...args], { credits: BUILD_JOBS, label, kind: "xcodebuild" }, env);
  return job.queued ? job : { command: "xcodebuild", args, queued: false };
}

/**
 * Builds used to go to <checkout>/.agent-pr-evidence/ios-derived, with their own copy of the Swift
 * packages (0.8-4.4 GB). With the shared layout nothing reads it, so delete it. Not in CI, where
 * agent:ios:ready still builds there. Returns whether it deleted anything.
 */
export function removeOldCheckoutDerivedData(repoRoot, log = console.log, env = process.env) {
  if (!iosDerivedDataDir(repoRoot, env)) return false;
  const old = path.join(repoRoot, ".agent-pr-evidence", "ios-derived");
  if (!fs.existsSync(old)) return false;
  fs.rmSync(old, { recursive: true, force: true });
  log(`deleted the unused ${path.relative(repoRoot, old)} (builds now use ${iosDerivedDataDir(repoRoot, env)})`);
  return true;
}
