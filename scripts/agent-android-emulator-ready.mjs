#!/usr/bin/env node
/**
 * Boot an Android emulator, install the debug APK, open a crewcue://dev deeplink, assert a label.
 */
import { execFile as execFileCb, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { androidSdkEnv } from "./lib/androidSdkEnv.mjs";
import { androidPort, sharedDevice } from "./lib/agentDevice.mjs";

const execFile = promisify(execFileCb);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(repoRoot, ".android-emulator/config.yaml");
const APP_ID = "com.crewcue.android";

function parseArgs(argv) {
  let deeplink = process.env.AGENT_ANDROID_DEEPLINK?.trim() || "crewcue://dev/hello";
  // Parallel agents each pass their own emulator so no one reinstalls over another's device.
  let serial = process.env.ANDROID_SERIAL?.trim() || undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--deeplink") deeplink = argv[++i];
    else if (arg.startsWith("--deeplink=")) deeplink = arg.slice("--deeplink=".length);
    else if (arg === "--serial") serial = argv[++i];
    else if (arg.startsWith("--serial=")) serial = arg.slice("--serial=".length);
    else if (arg === "--list-deeplinks") {
      const index = JSON.parse(fs.readFileSync(path.join(repoRoot, "clients/behavior/deeplinks.json"), "utf8"));
      for (const row of index.features ?? []) process.stdout.write(`${row.entry}\n`);
      process.exit(0);
    }
  }
  return { deeplink, serial };
}

function avdName() {
  if (!fs.existsSync(CONFIG)) return "crewcue_api_35";
  const match = fs.readFileSync(CONFIG, "utf8").match(/^\s*avdName:\s*(.+)\s*$/m);
  return match ? match[1].trim() : "crewcue_api_35";
}

const env = androidSdkEnv();

async function run(command, args) {
  const { stdout, stderr } = await execFile(command, args, {
    encoding: "utf8",
    cwd: repoRoot,
    env,
    maxBuffer: 20 * 1024 * 1024
  });
  return { stdout, stderr };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootAvd(name, port) {
  const emulator = path.join(env.ANDROID_HOME, "emulator/emulator");
  if (!fs.existsSync(emulator)) throw new Error(`emulator binary missing at ${emulator}`);
  // Always read-only, so every worktree can run its own instance of the same AVD at once.
  // The emulator refuses a read-only instance while any instance of that AVD runs without -read-only.
  const portArgs = port ? ["-port", String(port)] : [];
  const logPath = path.join(repoRoot, `.agent-pr-evidence/emulator-${port ?? "default"}.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.openSync(logPath, "w");
  const child = spawn(emulator, ["-avd", name, "-read-only", "-no-snapshot-save", ...portArgs, "-netdelay", "none", "-netspeed", "full"], {
    detached: true,
    stdio: ["ignore", log, log],
    env
  });
  child.unref();
  const wanted = port ? `emulator-${port}` : undefined;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode !== null) break;
    const serial = wanted ? ((await isOnline(wanted)) ? wanted : undefined) : await onlineSerial().catch(() => undefined);
    if (serial && (await bootCompleted(serial))) return serial;
    await sleep(2000);
  }
  const tail = fs.readFileSync(logPath, "utf8").trim().split("\n").slice(-3).join("\n");
  const hint = /Another emulator instance is running/.test(tail)
    ? `\nAn instance of ${name} is running without -read-only. Close it (adb -s <serial> emu kill) and boot again; every instance must be read-only.`
    : "";
  throw new Error(`AVD ${name}${wanted ? ` (${wanted})` : ""} did not come online. Emulator log ${logPath}:\n${tail}${hint}`);
}

async function isOnline(serial) {
  const { stdout } = await run("adb", ["devices"]).catch(() => ({ stdout: "" }));
  return stdout.split("\n").some((line) => line.trim().startsWith(`${serial}\t`) && line.trim().endsWith("device"));
}

async function bootCompleted(serial) {
  const { stdout } = await run("adb", ["-s", serial, "shell", "getprop", "sys.boot_completed"]).catch(() => ({ stdout: "" }));
  return stdout.trim() === "1";
}

async function onlineSerial() {
  const { stdout } = await run("adb", ["devices"]);
  const line = stdout
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.endsWith("\tdevice") || item.endsWith(" device"));
  return line?.split(/\s+/)[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { deeplink } = args;
  try {
    await run("adb", ["version"]);
  } catch {
    throw new Error("adb not found. Install Android platform-tools and set ANDROID_HOME.");
  }
  let serial = args.serial;
  if (serial) {
    if (!(await isOnline(serial))) throw new Error(`${serial} is not an online adb device.`);
  } else if (sharedDevice()) {
    serial = await onlineSerial();
    if (!serial) {
      const name = avdName();
      process.stdout.write(`agent-android-ready: booting AVD ${name}\n`);
      serial = await bootAvd(name);
    }
  } else {
    // This checkout's own emulator. Never fall back to another worktree's device.
    const port = androidPort(repoRoot);
    serial = `emulator-${port}`;
    if (!(await isOnline(serial))) {
      const name = avdName();
      process.stdout.write(`agent-android-ready: booting AVD ${name} as ${serial}\n`);
      await bootAvd(name, port);
    }
  }
  const gradle = fs.existsSync(path.join(repoRoot, "apps/android/gradlew"))
    ? path.join(repoRoot, "apps/android/gradlew")
    : "gradle";
  await run(gradle, ["-p", path.join(repoRoot, "apps/android"), ":app:assembleDebug"]);
  const apk = path.join(repoRoot, "apps/android/app/build/outputs/apk/debug/app-debug.apk");
  if (!fs.existsSync(apk)) throw new Error(`Missing ${apk}`);
  await run("adb", ["-s", serial, "install", "-r", apk]);
  await run("adb", ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", deeplink, APP_ID]);
  const dump = path.join(repoRoot, ".agent-pr-evidence/android-ui.xml");
  fs.mkdirSync(path.dirname(dump), { recursive: true });
  await run("adb", ["-s", serial, "shell", "uiautomator", "dump", "/sdcard/crewcue-ui.xml"]);
  const { stdout } = await run("adb", ["-s", serial, "exec-out", "cat", "/sdcard/crewcue-ui.xml"]);
  fs.writeFileSync(dump, stdout);
  const index = JSON.parse(fs.readFileSync(path.join(repoRoot, "clients/behavior/deeplinks.json"), "utf8"));
  const pathOnly = deeplink.split("?")[0];
  const row = (index.features ?? []).find((item) => item.entry === pathOnly);
  if (row && !stdout.includes(row.label)) {
    throw new Error(`UI dump missing ${row.label}`);
  }
  process.stdout.write(`agent-android-ready: serial=${serial}\n`);
  process.stdout.write(`agent-android-ready: opened ${deeplink}\n`);
  process.stdout.write("agent-android-ready: ok\n");
}

main().catch((error) => {
  process.stderr.write(`agent-android-ready: failed\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
