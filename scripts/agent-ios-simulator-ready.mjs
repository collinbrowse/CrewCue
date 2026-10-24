#!/usr/bin/env node
import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { openIosSimulatorUi } from "./lib/openIosSimulatorUi.mjs";

const execFile = promisify(execFileCb);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_ID = "com.crewcue.ios";
const PROJECT = path.join(repoRoot, "apps/ios/CrewCue.xcodeproj");
const CONFIG_PATH = path.join(repoRoot, ".xcodebuildmcp/config.yaml");
const DERIVED = path.join(repoRoot, ".agent-pr-evidence/ios-derived");

function deeplinksFromChecklists() {
  const indexPath = path.join(repoRoot, "clients/behavior/deeplinks.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  return (index.features ?? []).map((row) => row.entry);
}

function parseArgs(argv) {
  let deeplink = process.env.AGENT_IOS_DEEPLINK?.trim() || "crewcue://dev/hello";
  // Parallel agents each pass their own simulator so no one reinstalls over another's device.
  let udid = process.env.AGENT_IOS_UDID?.trim() || undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--deeplink") deeplink = argv[++i];
    else if (arg.startsWith("--deeplink=")) deeplink = arg.slice("--deeplink=".length);
    else if (arg === "--udid") udid = argv[++i];
    else if (arg.startsWith("--udid=")) udid = arg.slice("--udid=".length);
    else if (arg === "--allow-no-metro") {
      process.stdout.write("agent-ios-ready: Metro is not used by the SwiftUI app\n");
    } else if (arg === "--list-deeplinks") {
      for (const url of deeplinksFromChecklists()) process.stdout.write(`${url}\n`);
      process.exit(0);
    }
  }
  return { deeplink, udid };
}

async function run(command, args) {
  const { stdout, stderr } = await execFile(command, args, {
    encoding: "utf8",
    cwd: repoRoot,
    maxBuffer: 20 * 1024 * 1024
  });
  return { stdout, stderr };
}

function readSimulatorName() {
  if (!fs.existsSync(CONFIG_PATH)) return "iPhone 18 Pro";
  const text = fs.readFileSync(CONFIG_PATH, "utf8");
  const match = text.match(/^\s*simulatorName:\s*(.+)\s*$/m);
  return match ? match[1].trim() : "iPhone 18 Pro";
}

function findDeviceByName(parsed, name) {
  for (const [runtime, devices] of Object.entries(parsed.devices ?? {})) {
    if (!runtime.includes("iOS")) continue;
    for (const device of devices) {
      if (device.isAvailable && device.name === name) return device;
    }
  }
  return undefined;
}

function findAnyAvailableIphone(parsed) {
  for (const [runtime, devices] of Object.entries(parsed.devices ?? {})) {
    if (!runtime.includes("iOS")) continue;
    for (const device of devices) {
      if (device.isAvailable && device.name?.includes("iPhone")) return device;
    }
  }
  return undefined;
}

async function deviceByUdid(udid) {
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "available", "--json"]);
  const parsed = JSON.parse(stdout);
  return Object.values(parsed.devices ?? {})
    .flat()
    .find((device) => device.udid === udid);
}

async function bootSimulator(udid) {
  const current = await deviceByUdid(udid);
  if (current?.state === "Booted") return;
  await run("xcrun", ["simctl", "boot", udid]).catch(() => {});
  await openIosSimulatorUi(udid);
  await run("xcrun", ["simctl", "bootstatus", udid, "-b"]);
}

async function ensureSimulator(name) {
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "available", "--json"]);
  const parsed = JSON.parse(stdout);
  const target = findDeviceByName(parsed, name) ?? findAnyAvailableIphone(parsed);
  if (!target) throw new Error(`No simulator named "${name}" and no other iPhone simulator.`);
  if (target.name !== name) {
    process.stdout.write(`agent-ios-ready: WARN no simulator named "${name}"; using ${target.name}\n`);
  }
  if (target.state === "Booted") {
    process.stdout.write(`agent-ios-ready: using booted simulator ${target.name} (${target.udid})\n`);
    await openIosSimulatorUi(target.udid);
    return target.udid;
  }
  await bootSimulator(target.udid);
  process.stdout.write(`agent-ios-ready: booted simulator ${target.name} (${target.udid})\n`);
  return target.udid;
}

async function ensureSimulatorByUdid(udid) {
  const device = await deviceByUdid(udid);
  if (!device) throw new Error(`No available simulator with UDID ${udid}.`);
  await bootSimulator(udid);
  process.stdout.write(`agent-ios-ready: using simulator ${device.name} (${udid})\n`);
  return udid;
}

function findApp(dir) {
  if (!fs.existsSync(dir)) return undefined;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) return full;
    if (entry.isDirectory()) {
      const nested = findApp(full);
      if (nested) return nested;
    }
  }
  return undefined;
}

async function installApp(udid) {
  fs.mkdirSync(DERIVED, { recursive: true });
  await run("xcodebuild", [
    "-project",
    PROJECT,
    "-scheme",
    "CrewCue",
    "-destination",
    `id=${udid}`,
    "-derivedDataPath",
    DERIVED,
    "build"
  ]);
  const app = findApp(path.join(DERIVED, "Build", "Products"));
  if (!app) throw new Error("xcodebuild finished without a CrewCue.app product");
  await bootSimulator(udid);
  await run("xcrun", ["simctl", "install", udid, app]);
  return app;
}

async function main() {
  if (process.platform !== "darwin") throw new Error("agent:ios:ready requires macOS.");
  const args = parseArgs(process.argv.slice(2));
  const { deeplink } = args;
  if (!fs.existsSync(PROJECT)) throw new Error(`Missing ${PROJECT}`);
  const udid = args.udid ? await ensureSimulatorByUdid(args.udid) : await ensureSimulator(readSimulatorName());
  await installApp(udid);
  await bootSimulator(udid);
  await run("xcrun", ["simctl", "terminate", udid, BUNDLE_ID]).catch(() => {});
  await run("xcrun", ["simctl", "launch", udid, BUNDLE_ID, "--deeplink", deeplink]);
  for (const line of [
    `agent-ios-ready: simulatorId=${udid}`,
    `agent-ios-ready: opened ${deeplink}`,
    "agent-ios-ready: next — XcodeBuildMCP snapshot_ui → assert accessibility label",
    "agent-ios-ready: ok"
  ]) {
    process.stdout.write(`${line}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`agent-ios-ready: failed\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
