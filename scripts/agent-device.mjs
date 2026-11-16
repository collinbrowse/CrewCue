#!/usr/bin/env node
/**
 * Print this checkout's own simulator and emulator, creating the simulator if needed.
 * Pass the UDID to iOS simulator / XcodeBuildMCP tools and the serial to adb.
 * Usage: npm run agent:device
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { androidSerial, ensureIosSimulator, iosSimulatorName } from "./lib/agentDevice.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = path.join(repoRoot, ".xcodebuildmcp/config.yaml");
const deviceType =
  (fs.existsSync(config) && fs.readFileSync(config, "utf8").match(/^\s*simulatorName:\s*(.+)\s*$/m)?.[1].trim()) || "iPhone 18 Pro";

if (process.platform === "darwin") {
  try {
    const own = ensureIosSimulator(repoRoot, deviceType);
    console.log(`ios: ${own.name} udid=${own.udid}${own.created ? " (created)" : ""}`);
  } catch (error) {
    console.log(`ios: ${iosSimulatorName(repoRoot)} unavailable: ${error.message}`);
  }
}
console.log(`android: serial=${androidSerial(repoRoot)} (start with npm run agent:android:ready)`);
