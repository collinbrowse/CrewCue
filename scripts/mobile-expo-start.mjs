#!/usr/bin/env node
/**
 * Preload `apps/mobile/.env` before Expo CLI runs.
 *
 * Expo's @expo/env does not overwrite keys already present on `process.env`
 * (including empty strings). That can leave EXPO_PUBLIC_* unset in the Metro
 * dev bundle even when `.env` has values — this script forces EXPO_PUBLIC_*
 * from the file so `npm run dev:mobile` behaves consistently.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
/** Prefer Apple Silicon Homebrew Node when the current binary is Intel-prefix Homebrew (often broken after keg cleanup). */
const APPLE_SILICON_NODE = "/opt/homebrew/bin/node";
if (
  process.platform === "darwin" &&
  existsSync(APPLE_SILICON_NODE) &&
  process.execPath.startsWith("/usr/local/")
) {
  const result = spawnSync(APPLE_SILICON_NODE, [scriptPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd()
  });
  process.exit(result.status === null ? 1 : result.status ?? 1);
}

const __dirname = path.dirname(scriptPath);
const repoRoot = path.resolve(__dirname, "..");
const mobileRoot = path.join(repoRoot, "apps", "mobile");
const envPath = path.join(mobileRoot, ".env");
const expoCli = path.join(repoRoot, "node_modules", "expo", "bin", "cli");

if (!existsSync(path.join(mobileRoot, "package.json"))) {
  console.error("mobile-expo-start: expected apps/mobile/package.json under", mobileRoot);
  process.exit(1);
}

if (!existsSync(expoCli)) {
  console.error("mobile-expo-start: Expo CLI not found at", expoCli);
  process.exit(1);
}

if (existsSync(envPath)) {
  try {
    const parsed = parseEnv(readFileSync(envPath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (!key.startsWith("EXPO_PUBLIC_")) continue;
      if (value === undefined) continue;
      process.env[key] = String(value);
    }
  } catch (err) {
    console.error("mobile-expo-start: could not read", envPath);
    console.error(err);
    process.exit(1);
  }
}

process.env.NODE_ENV ||= "development";

const passthrough = process.argv.slice(2);
const expoArgs = passthrough.length > 0 ? passthrough : ["start"];

/**
 * Android emulator ↔ Metro: default LAN URLs can fail with connection reset.
 * Use the emulator's host loopback (10.0.2.2) when ADB shows a QEMU image.
 * Physical devices / Wi‑Fi: set REACT_NATIVE_PACKAGER_HOSTNAME to your LAN IP.
 */
function prepareAndroidDevNetworking(expoArgs) {
  const isRunAndroid = expoArgs.some((a) => a === "run:android" || a.startsWith("run:android"));
  if (!isRunAndroid) {
    return;
  }

  spawnSync("adb", ["reverse", "tcp:8081", "tcp:8081"], { encoding: "utf8" });

  if (process.env.REACT_NATIVE_PACKAGER_HOSTNAME?.trim()) {
    return;
  }

  const qemu = spawnSync("adb", ["shell", "getprop", "ro.kernel.qemu"], { encoding: "utf8" });
  if (qemu.status === 0 && (qemu.stdout ?? "").trim() === "1") {
    process.env.REACT_NATIVE_PACKAGER_HOSTNAME = "10.0.2.2";
  }
}

prepareAndroidDevNetworking(expoArgs);

const nodeForExpo =
  process.platform === "darwin" &&
  existsSync(APPLE_SILICON_NODE) &&
  process.execPath.startsWith("/usr/local/")
    ? APPLE_SILICON_NODE
    : process.execPath;

const child = spawn(nodeForExpo, [expoCli, ...expoArgs], {
  cwd: mobileRoot,
  stdio: "inherit",
  env: process.env
});

child.on("error", (err) => {
  console.error("mobile-expo-start: failed to spawn Expo", err);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
