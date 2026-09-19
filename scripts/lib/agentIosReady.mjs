/** Auth0-free __DEV__ QA entries (guest stack). Prefer these over login for agent proof. */
export const AUTH0_FREE_DEEPLINKS = [
  "crewcue://guest",
  "crewcue://dev/schedule-sheet",
  "crewcue://dev/cold-start",
  "crewcue://dev/pace-estimate",
  "crewcue://dev/crew-sheet-export",
  "crewcue://dev/gpx-import-progress"
];

const DEFAULT_SIMULATOR_NAME = "iPhone 16e";

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ deeplink: string | undefined, requireMetro: boolean, listDeeplinks: boolean }}
 */
export function parseIosReadyArgs(argv, env = process.env) {
  let deeplink = env.AGENT_IOS_DEEPLINK?.trim() || "crewcue://guest";
  let requireMetro = env.AGENT_IOS_ALLOW_NO_METRO !== "1";
  let listDeeplinks = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--deeplink") deeplink = argv[++i];
    else if (a.startsWith("--deeplink=")) deeplink = a.slice("--deeplink=".length);
    else if (a === "--allow-no-metro") requireMetro = false;
    else if (a === "--list-deeplinks") listDeeplinks = true;
  }
  return { deeplink, requireMetro, listDeeplinks };
}

/**
 * @param {string | undefined} text
 * @returns {string}
 */
export function readSimulatorNameFromConfigText(text) {
  if (!text) {
    return DEFAULT_SIMULATOR_NAME;
  }
  const match = text.match(/^\s*simulatorName:\s*(.+)\s*$/m);
  return match ? match[1].trim() : DEFAULT_SIMULATOR_NAME;
}

/**
 * @param {{ devices?: Record<string, Array<{ isAvailable?: boolean, name?: string, state?: string, udid?: string }>> }} parsed
 * @param {string} name
 */
export function findDeviceByName(parsed, name) {
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

/**
 * @param {string} udid
 * @param {string | undefined} deeplink
 * @returns {string[]}
 */
export function formatNextSteps(udid, deeplink) {
  return [
    `agent-ios-ready: simulatorId=${udid}`,
    `agent-ios-ready: opened ${deeplink}`,
    "agent-ios-ready: next \u2014 XcodeBuildMCP snapshot_ui \u2192 tap by AXLabel \u2192 screenshot",
    "agent-ios-ready: Auth0-free: crewcue://dev/schedule-sheet | cold-start | pace-estimate",
    "agent-ios-ready: ok"
  ].slice(0, 10);
}
