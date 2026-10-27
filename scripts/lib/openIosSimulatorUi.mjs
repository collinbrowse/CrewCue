import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/**
 * Open the iOS simulator UI for a device UDID.
 * Xcode ≤ 26 ships Simulator.app; Xcode 27+ ships Device Hub instead.
 */
export async function openIosSimulatorUi(udid) {
  try {
    await execFile("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid]);
    return;
  } catch {
    // Simulator.app was removed in Xcode 27.
  }

  if (udid) {
    try {
      await execFile("open", [`devices://device/open?id=${udid}`]);
      return;
    } catch {
      // Fall through to bringing Device Hub forward.
    }
  }

  await execFile("open", ["-a", "DeviceHub"]);
}
