import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function androidSdkRoot() {
  if (process.env.ANDROID_HOME && fs.existsSync(process.env.ANDROID_HOME)) return process.env.ANDROID_HOME;
  const mac = path.join(os.homedir(), "Library/Android/sdk");
  if (fs.existsSync(mac)) return mac;
  return process.env.ANDROID_HOME || mac;
}

export function androidSdkEnv() {
  const sdk = androidSdkRoot();
  const javaCandidates = [
    process.env.JAVA_HOME,
    "/opt/homebrew/opt/openjdk@21",
    "/usr/local/opt/openjdk@21"
  ].filter(Boolean);
  const javaHome = javaCandidates.find((candidate) => fs.existsSync(path.join(candidate, "bin/java")));
  const prefix = [javaHome ? path.join(javaHome, "bin") : undefined, path.join(sdk, "platform-tools"), path.join(sdk, "emulator"), path.join(sdk, "cmdline-tools/latest/bin")].filter(Boolean);
  return {
    ...process.env,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
    PATH: [...prefix, process.env.PATH].filter(Boolean).join(path.delimiter)
  };
}
