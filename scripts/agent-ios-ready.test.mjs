#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH0_FREE_DEEPLINKS,
  findDeviceByName,
  formatNextSteps,
  parseIosReadyArgs,
  readSimulatorNameFromConfigText
} from "./lib/agentIosReady.mjs";

test("parseIosReadyArgs uses Auth0-free guest deeplink by default", () => {
  const parsed = parseIosReadyArgs([], {});
  assert.equal(parsed.deeplink, "crewcue://guest");
  assert.equal(parsed.requireMetro, true);
  assert.equal(parsed.listDeeplinks, false);
});

test("parseIosReadyArgs honors env and CLI overrides", () => {
  const env = {
    AGENT_IOS_DEEPLINK: "  crewcue://dev/schedule-sheet  ",
    AGENT_IOS_ALLOW_NO_METRO: "1"
  };

  assert.deepEqual(parseIosReadyArgs(["--deeplink=crewcue://dev/pace-estimate"], env), {
    deeplink: "crewcue://dev/pace-estimate",
    requireMetro: false,
    listDeeplinks: false
  });

  assert.deepEqual(parseIosReadyArgs(["--deeplink", "crewcue://dev/cold-start", "--allow-no-metro"], {}), {
    deeplink: "crewcue://dev/cold-start",
    requireMetro: false,
    listDeeplinks: false
  });
});

test("parseIosReadyArgs exposes the allowlisted deeplink listing mode", () => {
  const parsed = parseIosReadyArgs(["--list-deeplinks"], {});
  assert.equal(parsed.listDeeplinks, true);
  assert.ok(AUTH0_FREE_DEEPLINKS.includes("crewcue://dev/pace-estimate"));
});

test("readSimulatorNameFromConfigText defaults and trims configured simulator", () => {
  assert.equal(readSimulatorNameFromConfigText(undefined), "iPhone 16e");
  assert.equal(readSimulatorNameFromConfigText("project: CrewCue\n"), "iPhone 16e");
  assert.equal(
    readSimulatorNameFromConfigText("simulatorName:   iPhone 17 Pro   \n"),
    "iPhone 17 Pro"
  );
});

test("findDeviceByName only selects available iOS devices with the target name", () => {
  const parsed = {
    devices: {
      "com.apple.CoreSimulator.SimRuntime.tvOS-26-0": [
        { isAvailable: true, name: "iPhone 16e", state: "Shutdown", udid: "tv" }
      ],
      "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
        { isAvailable: false, name: "iPhone 16e", state: "Shutdown", udid: "old" },
        { isAvailable: true, name: "iPhone 16e", state: "Shutdown", udid: "ios-target" }
      ]
    }
  };

  assert.equal(findDeviceByName(parsed, "iPhone 16e")?.udid, "ios-target");
  assert.equal(findDeviceByName(parsed, "iPhone SE"), undefined);
});

test("formatNextSteps stays concise and includes simulator evidence guidance", () => {
  const lines = formatNextSteps("UDID-1", "crewcue://dev/pace-estimate");
  assert.ok(lines.length <= 10);
  assert.deepEqual(lines.at(-1), "agent-ios-ready: ok");
  assert.ok(lines.some((line) => line.includes("snapshot_ui")));
  assert.ok(lines.some((line) => line.includes("crewcue://dev/pace-estimate")));
});
