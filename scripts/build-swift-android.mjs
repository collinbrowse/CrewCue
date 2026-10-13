#!/usr/bin/env node
/**
 * Cross-compile packages/client-core for Android and stage JNI libraries.
 * swift-java jextract is used when it is installed. Otherwise this script compiles
 * a generated JNI stub that forwards to the package's C exports.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(repoRoot, "packages/client-core");
const jniLibsDir = path.join(repoRoot, "apps/android/app/build/generated/jniLibs");
const triples = (process.env.SWIFT_ANDROID_TRIPLES || "aarch64-unknown-linux-android28,x86_64-unknown-linux-android28")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const abiForTriple = {
  "aarch64-unknown-linux-android28": { abi: "arm64-v8a", clang: "aarch64-linux-android28-clang", ndkLib: "aarch64-linux-android", swiftLib: "swift-aarch64" },
  "x86_64-unknown-linux-android28": { abi: "x86_64", clang: "x86_64-linux-android28-clang", ndkLib: "x86_64-linux-android", swiftLib: "swift-x86_64" }
};

const swiftRuntimeLibs = [
  "swiftCore",
  "swift_Concurrency",
  "swift_StringProcessing",
  "swift_RegexParser",
  "swift_Builtin_float",
  "swift_math",
  "swiftAndroid",
  "swiftDispatch",
  "swiftSwiftOnoneSupport",
  "dispatch",
  "BlocksRuntime",
  "Foundation",
  "FoundationEssentials",
  "FoundationInternationalization",
  "FoundationNetworking",
  "_FoundationICU",
  "swiftSynchronization"
];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findNdk() {
  if (process.env.ANDROID_NDK_HOME && fs.existsSync(process.env.ANDROID_NDK_HOME)) return process.env.ANDROID_NDK_HOME;
  const root = process.env.ANDROID_HOME || path.join(os.homedir(), "Library/Android/sdk");
  const ndkRoot = path.join(root, "ndk");
  if (!fs.existsSync(ndkRoot)) return undefined;
  const versions = fs.readdirSync(ndkRoot).filter((name) => fs.existsSync(path.join(ndkRoot, name, "toolchains"))).sort();
  return versions.length ? path.join(ndkRoot, versions[versions.length - 1]) : undefined;
}

function findSwiftSdkRoot() {
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

function ndkPrebuilt(ndk) {
  const prebuilt = path.join(ndk, "toolchains/llvm/prebuilt");
  if (!fs.existsSync(prebuilt)) return undefined;
  const host = fs.readdirSync(prebuilt).find((name) => name.startsWith("darwin"));
  return host ? path.join(prebuilt, host) : undefined;
}

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

function linkSharedLibrary(triple, info, buildDir, product) {
  const objects = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.includes("Tests")) continue;
        walk(full);
      } else if (entry.name.endsWith(".o")) {
        objects.push(full);
      }
    }
  }
  walk(buildDir);
  if (!objects.length) {
    console.error(`build-swift-android: no Android objects to link in ${buildDir}`);
    process.exit(1);
  }
  const ndk = findNdk();
  const prebuilt = ndk && ndkPrebuilt(ndk);
  if (!prebuilt) {
    console.error("build-swift-android: NDK clang not found while linking the shared library");
    process.exit(1);
  }
  const clang = path.join(prebuilt, "bin", info.clang);
  const sdkRoot = findSwiftSdkRoot();
  const runtime = sdkRoot ? path.join(sdkRoot, "swift-resources/usr/lib", info.swiftLib, "android") : undefined;
  const linkArgs = ["-shared", "-fPIC", "-Wl,--whole-archive", ...objects, "-Wl,--no-whole-archive"];
  if (runtime && fs.existsSync(runtime)) linkArgs.push("-L", runtime);
  for (const name of swiftRuntimeLibs) linkArgs.push(`-l${name}`);
  linkArgs.push("-lc++_shared", "-llog", "-ldl", "-lm", "-lc", "-o", product);
  console.log(`build-swift-android: linking ${objects.length} objects into ${product}`);
  run(clang, linkArgs);
}

function stageProduct(triple, info) {
  const buildDir = path.join(packageDir, ".build", triple, "debug");
  const product = path.join(buildDir, "libCrewCueClientCore.so");
  if (!fs.existsSync(product)) linkSharedLibrary(triple, info, buildDir, product);
  if (!fs.existsSync(product)) {
    console.error(`build-swift-android: missing ${product}`);
    process.exit(1);
  }
  const destDir = path.join(jniLibsDir, info.abi);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(product, path.join(destDir, "libCrewCueClientCore.so"));
  return { buildDir, destDir };
}

function compileJniStub(ndk, info, buildDir, destDir) {
  const prebuilt = ndkPrebuilt(ndk);
  if (!prebuilt) {
    console.error("build-swift-android: NDK prebuilt clang host not found");
    process.exit(1);
  }
  const clang = path.join(prebuilt, "bin", info.clang);
  const glue = path.join(repoRoot, "apps/android/app/build/generated/jni", `glue-${info.abi}.c`);
  fs.mkdirSync(path.dirname(glue), { recursive: true });
  fs.writeFileSync(glue, jniGlueSource());
  const sdkRoot = findSwiftSdkRoot();
  const linkArgs = ["-shared", "-fPIC", glue];
  if (sdkRoot) {
    const runtime = path.join(sdkRoot, "swift-resources/usr/lib", info.swiftLib, "android");
    if (fs.existsSync(runtime)) linkArgs.push("-L", runtime);
  }
  linkArgs.push("-L", buildDir, "-lCrewCueClientCore", "-o", path.join(destDir, "libCrewCueClientCoreJni.so"));
  const cxx = path.join(sdkRoot ?? "", "ndk-sysroot/usr/lib", info.ndkLib, "libc++_shared.so");
  run(clang, linkArgs);
  const ndkCxx = path.join(ndk, "toolchains/llvm/prebuilt", path.basename(prebuilt), "sysroot/usr/lib", info.ndkLib, "libc++_shared.so");
  copyIfExists(fs.existsSync(cxx) ? cxx : ndkCxx, path.join(destDir, "libc++_shared.so"));
}

function copyRuntime(info, destDir) {
  const sdkRoot = findSwiftSdkRoot();
  if (!sdkRoot) {
    console.log("build-swift-android: Swift Android SDK root not found. Runtime .so files were not staged.");
    return;
  }
  const runtime = path.join(sdkRoot, "swift-resources/usr/lib", info.swiftLib, "android");
  for (const name of swiftRuntimeLibs) {
    copyIfExists(path.join(runtime, `lib${name}.so`), path.join(destDir, `lib${name}.so`));
  }
}

function jniGlueSource() {
  return `#include <jni.h>
#include <stdlib.h>
extern char *crewcue_hello_stamp(void);
extern char *crewcue_feature_screen_json_for_url(const char *url);
extern char *crewcue_runtime_json(const char *request);
static jstring adopt(JNIEnv *env, char *value) {
  if (!value) return NULL;
  jstring result = (*env)->NewStringUTF(env, value);
  free(value);
  return result;
}
JNIEXPORT jstring JNICALL Java_com_crewcue_clientcore_CrewCueClientCore_helloStamp(JNIEnv *env, jclass clazz) {
  (void)clazz;
  return adopt(env, crewcue_hello_stamp());
}
JNIEXPORT jstring JNICALL Java_com_crewcue_clientcore_CrewCueClientCore_featureScreenJsonForUrl(JNIEnv *env, jclass clazz, jstring url) {
  (void)clazz;
  const char *chars = url ? (*env)->GetStringUTFChars(env, url, NULL) : "";
  char *json = crewcue_feature_screen_json_for_url(chars);
  if (url) (*env)->ReleaseStringUTFChars(env, url, chars);
  return adopt(env, json);
}
JNIEXPORT jstring JNICALL Java_com_crewcue_clientcore_CrewCueClientCore_runtimeJson(JNIEnv *env, jclass clazz, jstring request) {
  (void)clazz;
  const char *chars = request ? (*env)->GetStringUTFChars(env, request, NULL) : "";
  char *json = crewcue_runtime_json(chars);
  if (request) (*env)->ReleaseStringUTFChars(env, request, chars);
  return adopt(env, json);
}
`;
}

const swift = process.env.SWIFT_BIN || "swift";
for (const triple of triples) {
  const info = abiForTriple[triple];
  if (!info) {
    console.error(`build-swift-android: unsupported triple ${triple}`);
    process.exit(1);
  }
  run(swift, ["build", "--package-path", packageDir, "--swift-sdk", triple]);
  const staged = stageProduct(triple, info);
  const ndk = findNdk();
  if (!ndk) {
    console.error("build-swift-android: Android NDK not found. Set ANDROID_NDK_HOME.");
    process.exit(1);
  }
  compileJniStub(ndk, info, staged.buildDir, staged.destDir);
  copyRuntime(info, staged.destDir);
}

const jextract = spawnSync("swift-java", ["--help"], { encoding: "utf8" });
if (jextract.status !== 0) {
  console.log("build-swift-android: staged JNI libraries. swift-java is not installed, so the generated stub forwards the C exports.");
  process.exit(0);
}
const extract = spawnSync("swift-java", [
  "jextract",
  "--mode=jni",
  "--swift-module",
  "CrewCueClientCore",
  "--input-swift",
  path.join(packageDir, "Sources/CrewCueClientCore"),
  "--output-java",
  path.join(repoRoot, "apps/android/app/build/generated/swift-java-preview")
], { stdio: "inherit" });
if (extract.status !== 0) {
  console.log("build-swift-android: jextract failed. The generated JNI stub still forwards the C exports.");
}
