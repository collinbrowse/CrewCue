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
const GUEST_DEEPLINK = "crewcue://guest";

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

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("agent:ios:ready requires macOS.");
  }

  try {
    await run("xcrun", ["--version"]);
  } catch {
    throw new Error("xcrun not found. Install Xcode command-line tools.");
  }

  if (!fs.existsSync(WORKSPACE)) {
    throw new Error(
      `Missing ${WORKSPACE}. From apps/mobile run: npx expo prebuild`
    );
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
    process.stdout.write(
      "agent-ios-ready: WARN Metro not detected on :8081. Start: REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 npm run dev:mobile\n"
    );
  } else {
    process.stdout.write("agent-ios-ready: Metro OK on :8081\n");
  }

  try {
    await run("xcrun", ["simctl", "openurl", udid, GUEST_DEEPLINK]);
    process.stdout.write(`agent-ios-ready: opened ${GUEST_DEEPLINK}\n`);
  } catch (e) {
    process.stdout.write(
      `agent-ios-ready: WARN could not open guest deeplink (${e instanceof Error ? e.message : e}). Open the CrewCue dev client manually.\n`
    );
  }

  process.stdout.write(`agent-ios-ready: simulatorId=${udid}\n`);
  process.stdout.write("agent-ios-ready: ok — use XcodeBuildMCP with this UDID if needed\n");
}

main().catch((error) => {
  process.stderr.write(`agent-ios-ready: failed\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
