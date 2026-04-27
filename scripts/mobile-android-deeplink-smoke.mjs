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

async function getConnectedAndroidSerial() {
  const { stdout } = await run("adb", ["devices"]);
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("List of devices attached"));

  const onlineDevices = lines
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[0] && parts[1] === "device")
    .map((parts) => parts[0]);

  return onlineDevices[0];
}

async function main() {
  try {
    await run("adb", ["version"]);
  } catch {
    throw new Error("adb not found. Install Android platform tools and ensure adb is on PATH.");
  }

  const serial = await getConnectedAndroidSerial();
  if (!serial) {
    throw new Error("No connected Android device/emulator found. Start one, then rerun.");
  }

  process.stdout.write(`mobile-android-deeplink-smoke: using device ${serial}\n`);

  for (const url of DEEPLINKS) {
    await run("adb", ["-s", serial, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", url]);
    process.stdout.write(`opened ${url}\n`);
  }

  process.stdout.write("mobile-android-deeplink-smoke: ok\n");
}

main().catch((error) => {
  process.stderr.write(`mobile-android-deeplink-smoke: failed\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
