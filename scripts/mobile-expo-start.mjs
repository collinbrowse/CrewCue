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
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

const child = spawn(process.execPath, [expoCli, ...expoArgs], {
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
