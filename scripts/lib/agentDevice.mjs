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
