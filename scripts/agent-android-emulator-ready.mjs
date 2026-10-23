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

const execFile = promisify(execFileCb);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(repoRoot, ".android-emulator/config.yaml");
const APP_ID = "com.crewcue.android";

function parseArgs(argv) {
  let deeplink = process.env.AGENT_ANDROID_DEEPLINK?.trim() || "crewcue://dev/hello";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--deeplink") deeplink = argv[++i];
    else if (arg.startsWith("--deeplink=")) deeplink = arg.slice("--deeplink=".length);
    else if (arg === "--list-deeplinks") {
      const index = JSON.parse(fs.readFileSync(path.join(repoRoot, "clients/behavior/deeplinks.json"), "utf8"));
      for (const row of index.features ?? []) process.stdout.write(`${row.entry}\n`);
      process.exit(0);
    }
  }
  return { deeplink };
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

async function bootAvd(name) {
  const emulator = path.join(env.ANDROID_HOME, "emulator/emulator");
  if (!fs.existsSync(emulator)) throw new Error(`emulator binary missing at ${emulator}`);
  const child = spawn(emulator, ["-avd", name, "-netdelay", "none", "-netspeed", "full"], {
    detached: true,
    stdio: "ignore",
    env
  });
  child.unref();
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const serial = await onlineSerial().catch(() => undefined);
    if (serial) return serial;
    await sleep(2000);
  }
  throw new Error(`AVD ${name} did not come online.`);
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
  const { deeplink } = parseArgs(process.argv.slice(2));
  try {
    await run("adb", ["version"]);
  } catch {
    throw new Error("adb not found. Install Android platform-tools and set ANDROID_HOME.");
  }
  let serial = await onlineSerial();
  if (!serial) {
    const name = avdName();
    process.stdout.write(`agent-android-ready: booting AVD ${name}\n`);
    serial = await bootAvd(name);
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
