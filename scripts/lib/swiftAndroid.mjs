import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Root of the installed Swift Android SDK bundle (`.../swift-android`), or undefined. */
export function findSwiftSdkRoot() {
  if (process.env.SWIFT_ANDROID_SDK_ROOT && fs.existsSync(process.env.SWIFT_ANDROID_SDK_ROOT)) return process.env.SWIFT_ANDROID_SDK_ROOT;
  const bases = [
    path.join(os.homedir(), "Library/org.swift.swiftpm/swift-sdks"),
    path.join(os.homedir(), ".swiftpm/swift-sdks")
  ];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const bundle = fs.readdirSync(base).find((name) => name.includes("android") && name.endsWith(".artifactbundle"));
    if (bundle) return path.join(base, bundle, "swift-android");
  }
  return undefined;
}

/**
 * Swift compiler matching the Android SDK version. Xcode's `swift` is usually newer than the SDK
 * and cannot import its modules, so prefer the toolchain named after the SDK bundle.
 * Returns undefined when the SDK names a version whose toolchain is not installed.
 */
export function findSwiftForAndroid() {
  if (process.env.SWIFT_BIN) return process.env.SWIFT_BIN;
  const sdkRoot = findSwiftSdkRoot();
  const version = sdkRoot && /swift-([\d.]+)-RELEASE_android/.exec(sdkRoot)?.[1];
  if (!version) return "swift";
  for (const base of [path.join(os.homedir(), "Library/Developer/Toolchains"), "/Library/Developer/Toolchains"]) {
    const candidate = path.join(base, `swift-${version}-RELEASE.xctoolchain/usr/bin/swift`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}
