import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * The Swift Android SDK only works with the compiler release it was built for.
 * Xcode's `swift` moves ahead of it, so prefer a matching swift.org toolchain when one is installed.
 */
export function swiftForAndroid() {
  if (process.env.SWIFT_BIN) return process.env.SWIFT_BIN;
  const version = androidSdkSwiftVersion();
  if (version && process.platform === "darwin") {
    for (const base of ["/Library/Developer/Toolchains", path.join(os.homedir(), "Library/Developer/Toolchains")]) {
      const swift = path.join(base, `swift-${version}-RELEASE.xctoolchain/usr/bin/swift`);
      if (fs.existsSync(swift)) return swift;
    }
  }
  return "swift";
}

/** Swift release of the installed Android SDK bundle, e.g. "6.3.2". */
export function androidSdkSwiftVersion() {
  const listed = spawnSync("swift", ["sdk", "list"], { encoding: "utf8" });
  const match = `${listed.stdout ?? ""}`.match(/swift-(\d+\.\d+(?:\.\d+)?)-RELEASE[_-]android/i);
  return match?.[1];
}
