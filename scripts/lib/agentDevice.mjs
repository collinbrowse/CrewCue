/**
 * One simulator and one emulator per checkout, so parallel agents (each in its own git worktree)
 * never install over, reset or screenshot each other's device.
 *
 * iOS:     a simulator named "CrewCue <checkout>" of the configured device type, created on first use.
 * Android: the configured AVD started read-only on a port derived from the checkout,
 *          so its serial is emulator-<port>. Several read-only instances of one AVD can run at once.
 *
 * CI, or CREWCUE_SHARED_DEVICE=1, keeps the old behavior (any booted device).
 * CREWCUE_ANDROID_PORT overrides the derived port.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FIRST_PORT = 5556; // 5554 stays free for the emulator a person starts by hand.
export const PORT_SLOTS = 60; // 5556..5674, even ports only (the emulator also takes port + 1).

export function sharedDevice(env = process.env) {
  return Boolean(env.CI) || env.CREWCUE_SHARED_DEVICE === "1";
}

/** Stable short name for a checkout: the worktree folder name. */
export function checkoutKey(repoRoot) {
  return path.basename(path.resolve(repoRoot)).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "crewcue";
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function androidPort(repoRoot, env = process.env) {
  const override = Number.parseInt(env.CREWCUE_ANDROID_PORT ?? "", 10);
  if (Number.isInteger(override) && override >= 5554 && override <= 5682 && override % 2 === 0) return override;
  return FIRST_PORT + 2 * (fnv1a(checkoutKey(repoRoot)) % PORT_SLOTS);
}

export function androidSerial(repoRoot, env = process.env) {
  return `emulator-${androidPort(repoRoot, env)}`;
}

export function iosSimulatorName(repoRoot) {
  return `CrewCue ${checkoutKey(repoRoot)}`;
}

function simctlDevices() {
  const listed = spawnSync("xcrun", ["simctl", "list", "devices", "available", "--json"], { encoding: "utf8" });
  if (listed.status !== 0) throw new Error(listed.stderr || "simctl list failed");
  return Object.entries(JSON.parse(listed.stdout).devices ?? {})
    .filter(([runtime]) => runtime.includes("iOS"))
    .flatMap(([, devices]) => devices);
}

/** UDID of this checkout's simulator, creating it (as `deviceType`, newest iOS runtime) if needed. */
export function ensureIosSimulator(repoRoot, deviceType) {
  const name = iosSimulatorName(repoRoot);
  const existing = simctlDevices().find((device) => device.name === name && device.isAvailable !== false);
  if (existing) return { udid: existing.udid, name, state: existing.state, created: false };
  const created = spawnSync("xcrun", ["simctl", "create", name, deviceType], { encoding: "utf8" });
  if (created.status !== 0) {
    throw new Error(`Could not create simulator "${name}" (${deviceType}): ${created.stderr.trim()}`);
  }
  return { udid: created.stdout.trim(), name, state: "Shutdown", created: true };
}

/*
 * Android goes one worktree at a time. A machine-wide lock (a directory, so creating it is atomic)
 * names the worktree that may run an emulator. agent:android:ready and test:android take it and
 * refresh it; agent:android:done stops that worktree's emulator and frees it. A lock nobody has
 * touched for LOCK_STALE_MS, or whose worktree no longer exists, is taken over.
 */

export const LOCK_STALE_MS = 45 * 60 * 1000;

export function androidLockDir(env = process.env) {
  return env.CREWCUE_ANDROID_LOCK_DIR || path.join(os.homedir(), ".crewcue", "android-device.lock");
}

export function readAndroidLock(env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(path.join(androidLockDir(env), "owner.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function writeOwner(lockDir, repoRoot, env) {
  const owner = { checkout: checkoutKey(repoRoot), repoRoot: path.resolve(repoRoot), serial: androidSerial(repoRoot, env), touchedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify(owner, null, 2));
  return owner;
}

export function lockIsStale(owner, now = Date.now()) {
  if (!owner) return true;
  if (!owner.repoRoot || !fs.existsSync(owner.repoRoot)) return true;
  return now - Date.parse(owner.touchedAt ?? 0) > LOCK_STALE_MS;
}

/** One attempt. Returns { acquired: true, owner } or { acquired: false, owner } for the current holder. */
export function tryAcquireAndroid(repoRoot, env = process.env, now = Date.now()) {
  const lockDir = androidLockDir(env);
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  try {
    fs.mkdirSync(lockDir);
    return { acquired: true, owner: writeOwner(lockDir, repoRoot, env) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const owner = readAndroidLock(env);
  // A holder writes owner.json just after creating the directory; don't steal in that gap.
  if (!owner && now - fs.statSync(lockDir).mtimeMs < 10000) return { acquired: false, owner: { checkout: "another worktree" } };
  if (owner?.repoRoot === path.resolve(repoRoot)) return { acquired: true, owner: writeOwner(lockDir, repoRoot, env) };
  if (lockIsStale(owner, now)) {
    fs.rmSync(lockDir, { recursive: true, force: true });
    return tryAcquireAndroid(repoRoot, env, now);
  }
  return { acquired: false, owner };
}

/** Waits up to waitMs for the Android turn. Throws with the holder's name when it never comes. */
export async function acquireAndroid(repoRoot, { waitMs = 5 * 60 * 1000, pollMs = 15000, log = console.log, env = process.env } = {}) {
  const deadline = Date.now() + waitMs;
  let announced = "";
  for (;;) {
    const result = tryAcquireAndroid(repoRoot, env);
    if (result.acquired) return result.owner;
    if (announced !== result.owner?.checkout) {
      announced = result.owner?.checkout;
      log(`android: waiting for ${announced} to finish (it runs npm run agent:android:done when done; stale after ${LOCK_STALE_MS / 60000} min idle)`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Android is in use by ${announced}. Do non-Android work and retry later; never use its emulator.`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** Frees the lock if this worktree holds it. Returns whether it did. */
export function releaseAndroid(repoRoot, env = process.env) {
  const owner = readAndroidLock(env);
  if (!owner || owner.repoRoot !== path.resolve(repoRoot)) return false;
  fs.rmSync(androidLockDir(env), { recursive: true, force: true });
  return true;
}
