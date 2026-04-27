import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const DEEPLINKS = [
  "crewcue://guest",
  "crewcue://operate",
  "crewcue://operate/status",
  "crewcue://operate/outbox",
  "crewcue://readouts",
  "crewcue://readouts/incidents"
];

async function run(command, args) {
  const { stdout, stderr } = await execFile(command, args, { encoding: "utf8" });
  return { stdout, stderr };
}

async function getBootedSimulatorUdid() {
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "booted", "--json"]);
  const parsed = JSON.parse(stdout);
  const all = Object.values(parsed.devices ?? {}).flat();
  const iosDevice = all.find((device) => device.isAvailable && device.state === "Booted");
  return iosDevice?.udid;
}

async function getAvailableSimulatorUdid() {
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "available", "--json"]);
  const parsed = JSON.parse(stdout);
  const runtimeKeys = Object.keys(parsed.devices ?? {}).filter((key) => key.includes("iOS"));
  for (const key of runtimeKeys) {
    const devices = parsed.devices[key] ?? [];
    const candidate = devices.find((device) => device.isAvailable && device.name?.includes("iPhone"));
    if (candidate?.udid) {
      return candidate.udid;
    }
  }
  return undefined;
}

async function ensureBootedSimulator() {
  const booted = await getBootedSimulatorUdid();
  if (booted) return booted;

  const candidate = await getAvailableSimulatorUdid();
  if (!candidate) {
    throw new Error("No available iOS simulator device found.");
  }

  await run("xcrun", ["simctl", "boot", candidate]);
  await run("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", candidate]);
  await run("xcrun", ["simctl", "bootstatus", candidate, "-b"]);
  return candidate;
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("iOS simulator smoke requires macOS.");
  }

  try {
    await run("xcrun", ["--version"]);
  } catch {
    throw new Error("xcrun not found. Install Xcode command line tools.");
  }

  const udid = await ensureBootedSimulator();
  process.stdout.write(`mobile-ios-deeplink-smoke: using simulator ${udid}\n`);

  for (const url of DEEPLINKS) {
    await run("xcrun", ["simctl", "openurl", udid, url]);
    process.stdout.write(`opened ${url}\n`);
  }

  process.stdout.write("mobile-ios-deeplink-smoke: ok\n");
}

main().catch((error) => {
  process.stderr.write(`mobile-ios-deeplink-smoke: failed\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
