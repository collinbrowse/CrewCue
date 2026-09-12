#!/usr/bin/env node
import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BUNDLE_ID = "com.crewcue.mobile";
const WORKSPACE = path.join(repoRoot, "apps/mobile/ios/CrewCue.xcworkspace");
const CONFIG_PATH = path.join(repoRoot, ".xcodebuildmcp/config.yaml");

/** Auth0-free __DEV__ QA entries (guest stack). Prefer these over login for agent proof. */
const AUTH0_FREE_DEEPLINKS = [
  "crewcue://guest",
  "crewcue://dev/schedule-sheet",
  "crewcue://dev/cold-start",
  "crewcue://dev/pace-estimate",
  "crewcue://dev/crew-sheet-export",
  "crewcue://dev/gpx-import-progress"
];

function parseArgs(argv) {
  let deeplink = process.env.AGENT_IOS_DEEPLINK?.trim() || "crewcue://guest";
  let requireMetro = process.env.AGENT_IOS_ALLOW_NO_METRO !== "1";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--deeplink") deeplink = argv[++i];
    else if (a.startsWith("--deeplink=")) deeplink = a.slice("--deeplink=".length);
    else if (a === "--allow-no-metro") requireMetro = false;
    else if (a === "--list-deeplinks") {
      for (const u of AUTH0_FREE_DEEPLINKS) process.stdout.write(`${u}\n`);
      process.exit(0);
    }
  }
  return { deeplink, requireMetro };
}

async function run(command, args) {
  const { stdout, stderr } = await execFile(command, args, { encoding: "utf8" });
  return { stdout, stderr };
}

function readSimulatorName() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return "iPhone 16e";
  }
  const text = fs.readFileSync(CONFIG_PATH, "utf8");
  const match = text.match(/^\s*simulatorName:\s*(.+)\s*$/m);
  return match ? match[1].trim() : "iPhone 16e";
}

async function listDevices() {
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "available", "--json"]);
  return JSON.parse(stdout);
}

function findDeviceByName(parsed, name) {
  for (const [runtime, devices] of Object.entries(parsed.devices ?? {})) {
    if (!runtime.includes("iOS")) continue;
    for (const device of devices) {
      if (device.isAvailable && device.name === name) {
        return device;
      }
    }
  }
  return undefined;
}

async function bootSimulator(udid) {
  await run("xcrun", ["simctl", "boot", udid]);
  await run("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid]);
  await run("xcrun", ["simctl", "bootstatus", udid, "-b"]);
}

async function ensureSimulator(name) {
  const parsed = await listDevices();
  const booted = Object.values(parsed.devices ?? {})
    .flat()
    .find((d) => d.state === "Booted" && d.isAvailable);

  if (booted) {
    process.stdout.write(`agent-ios-ready: using booted simulator ${booted.name} (${booted.udid})\n`);
    return booted.udid;
  }

  const target = findDeviceByName(parsed, name);
  if (!target) {
    throw new Error(
      `No simulator named "${name}". Install a matching runtime in Xcode → Settings → Components, or change simulatorName in .xcodebuildmcp/config.yaml.`
    );
  }

  await bootSimulator(target.udid);
  process.stdout.write(`agent-ios-ready: booted ${target.name} (${target.udid})\n`);
  return target.udid;
}

async function isAppInstalled(udid) {
  try {
    await run("xcrun", ["simctl", "get_app_container", udid, BUNDLE_ID]);
    return true;
  } catch {
    return false;
  }
}

async function isMetroUp() {
  try {
    const res = await fetch("http://127.0.0.1:8081/status", { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function printNextSteps(udid, deeplink) {
  const lines = [
    `agent-ios-ready: simulatorId=${udid}`,
    `agent-ios-ready: opened ${deeplink}`,
    "agent-ios-ready: next — XcodeBuildMCP snapshot_ui → tap by AXLabel → screenshot",
    "agent-ios-ready: Auth0-free: crewcue://dev/schedule-sheet | cold-start | pace-estimate",
    "agent-ios-ready: ok"
  ];
  for (const line of lines.slice(0, 10)) {
    process.stdout.write(`${line}\n`);
  }
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("agent:ios:ready requires macOS.");
  }

  const { deeplink, requireMetro } = parseArgs(process.argv.slice(2));

  try {
    await run("xcrun", ["--version"]);
  } catch {
    throw new Error("xcrun not found. Install Xcode command-line tools.");
  }

  if (!fs.existsSync(WORKSPACE)) {
    throw new Error(`Missing ${WORKSPACE}. From apps/mobile run: npx expo prebuild`);
  }

  const simulatorName = readSimulatorName();
  const udid = await ensureSimulator(simulatorName);

  const appInstalled = await isAppInstalled(udid);
  if (!appInstalled) {
    throw new Error(
      `Dev client ${BUNDLE_ID} not installed on simulator. Run: npm run ios -w @crewcue/mobile`
    );
  }

  const metro = await isMetroUp();
  if (!metro) {
    if (requireMetro) {
      throw new Error(
        "Metro not detected on :8081. Start: REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 npm run dev:mobile (or pass --allow-no-metro / AGENT_IOS_ALLOW_NO_METRO=1)."
      );
    }
    process.stdout.write("agent-ios-ready: WARN Metro not detected on :8081 (allowed)\n");
  } else {
    process.stdout.write("agent-ios-ready: Metro OK on :8081\n");
  }

  try {
    await run("xcrun", ["simctl", "openurl", udid, deeplink]);
  } catch (e) {
    throw new Error(
      `Could not open ${deeplink} (${e instanceof Error ? e.message : e}). Is the CrewCue dev client installed?`
    );
  }

  printNextSteps(udid, deeplink);
}

main().catch((error) => {
  process.stderr.write(`agent-ios-ready: failed\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
