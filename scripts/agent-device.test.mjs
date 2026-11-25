import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { androidPort, androidSerial, checkoutKey, emulatorGpu, FIRST_PORT, IOS_PACKAGE_RESOLVED, iosDerivedDataDir, iosSimulatorName, iosSimulatorNames, packageResolvedKey, PORT_SLOTS, sharedDevice, sharedSourcePackagesArgs, SOFTWARE_GPU } from "./lib/agentDevice.mjs";
import { removeOldCheckoutDerivedData, RESOLVED_MARKER, sharedPackagesReady } from "./lib/iosBuild.mjs";
import { slotAvailable, slotPath, slotted } from "./lib/slot.mjs";

const worktree = (name) => `/Users/x/CrewCue/.claude/worktrees/${name}`;

test("each worktree gets its own simulator name", () => {
  assert.equal(iosSimulatorName(worktree("billing-649-ab12")), "CrewCue billing-649-ab12");
  assert.notEqual(iosSimulatorName(worktree("a")), iosSimulatorName(worktree("b")));
  assert.equal(checkoutKey("/tmp/odd name!"), "odd-name-");
});

test("emulator ports are even, in range, stable, and skip 5554", () => {
  const ports = new Set();
  for (let i = 0; i < 200; i++) {
    const port = androidPort(worktree(`session-${i}`), {});
    assert.equal(port % 2, 0);
    assert.ok(port >= FIRST_PORT && port < FIRST_PORT + 2 * PORT_SLOTS);
    assert.equal(port, androidPort(worktree(`session-${i}`), {}));
    ports.add(port);
  }
  assert.ok(ports.size > 40, "ports spread across the range");
  assert.equal(androidSerial(worktree("x"), { CREWCUE_ANDROID_PORT: "5600" }), "emulator-5600");
  assert.notEqual(androidPort(worktree("x"), { CREWCUE_ANDROID_PORT: "5601" }), 5601, "odd override ignored");
});

test("emulator GPU mode comes from the environment, unknown values ignored", () => {
  assert.equal(emulatorGpu({}), undefined);
  assert.equal(emulatorGpu({ CREWCUE_EMULATOR_GPU: SOFTWARE_GPU }), "swiftshader_indirect");
  assert.equal(emulatorGpu({ CREWCUE_EMULATOR_GPU: " host " }), "host");
  assert.equal(emulatorGpu({ CREWCUE_EMULATOR_GPU: "-no-window" }), undefined);
});

test("CI and the opt-out share devices", () => {
  assert.equal(sharedDevice({}), false);
  assert.equal(sharedDevice({ CI: "true" }), true);
  assert.equal(sharedDevice({ CREWCUE_SHARED_DEVICE: "1" }), true);
});

test("Android goes to one worktree at a time", async () => {
  const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { tryAcquireAndroid, releaseAndroid, readAndroidLock, LOCK_STALE_MS } = await import("./lib/agentDevice.mjs");
  const base = mkdtempSync(join(tmpdir(), "crewcue-lock-"));
  const env = { CREWCUE_ANDROID_LOCK_DIR: join(base, "lock") };
  const a = join(base, "wt-a");
  const b = join(base, "wt-b");
  mkdirSync(a);
  mkdirSync(b);
  try {
    assert.equal(tryAcquireAndroid(a, env).acquired, true);
    assert.equal(tryAcquireAndroid(a, env).acquired, true, "re-entrant for the holder");
    const blocked = tryAcquireAndroid(b, env);
    assert.equal(blocked.acquired, false);
    assert.equal(blocked.owner.checkout, "wt-a");
    assert.equal(releaseAndroid(b, env), false, "only the holder frees it");
    assert.equal(releaseAndroid(a, env), true);
    assert.equal(tryAcquireAndroid(b, env).acquired, true, "next worktree gets it");
    assert.equal(tryAcquireAndroid(a, env, Date.now() + LOCK_STALE_MS + 1000).acquired, true, "idle lock is taken over");
    assert.equal(readAndroidLock(env).checkout, "wt-a");
    rmSync(a, { recursive: true });
    assert.equal(tryAcquireAndroid(b, env).acquired, true, "lock of a deleted worktree is taken over");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("each checkout owns its simulator and its Duo twin", () => {
  assert.deepEqual(iosSimulatorNames(worktree("billing-649-ab12")), ["CrewCue billing-649-ab12", "CrewCue billing-649-ab12 Duo"]);
});

test("package checkouts are shared locally per Package.resolved, left to xcodebuild in CI", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "crewcue-spm-"));
  try {
    assert.deepEqual(sharedSourcePackagesArgs(repo, { CI: "true" }), []);
    assert.equal(packageResolvedKey(repo), "unresolved");
    const resolved = path.join(repo, IOS_PACKAGE_RESOLVED);
    mkdirSync(path.dirname(resolved), { recursive: true });
    writeFileSync(resolved, '{"pins":[{"identity":"a","state":{"version":"1.0.0"}}]}');
    const first = packageResolvedKey(repo);
    assert.match(first, /^[0-9a-f]{16}$/);
    assert.deepEqual(sharedSourcePackagesArgs(repo, { CREWCUE_SPM_CACHE: "/tmp/spm" }), ["-clonedSourcePackagesDirPath", `/tmp/spm/${first}`]);
    const [flag, dir] = sharedSourcePackagesArgs(repo, {});
    assert.equal(flag, "-clonedSourcePackagesDirPath");
    assert.match(dir, new RegExp(`Library/Caches/CrewCue/SourcePackages/${first}$`));
    writeFileSync(resolved, '{"pins":[{"identity":"a","state":{"version":"2.0.0"}}]}');
    assert.notEqual(packageResolvedKey(repo), first, "different pins get a different folder");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a resolved package folder is reused without resolving again, unless an artifact is missing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "crewcue-spm-ready-"));
  try {
    mkdirSync(path.join(dir, "checkouts"));
    mkdirSync(path.join(dir, "artifacts", "x", "X.xcframework"), { recursive: true });
    const artifact = path.join(dir, "artifacts", "x", "X.xcframework");
    writeFileSync(path.join(dir, "workspace-state.json"), JSON.stringify({ object: { artifacts: [{ path: artifact }] } }));
    assert.equal(sharedPackagesReady(dir), false, "never resolved here");
    writeFileSync(path.join(dir, RESOLVED_MARKER), "2026-11-25\n");
    assert.equal(sharedPackagesReady(dir), true);
    rmSync(artifact, { recursive: true });
    assert.equal(sharedPackagesReady(dir), false, "a missing xcframework needs a resolve");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each checkout has one DerivedData folder under ~/Library, CI keeps the default", () => {
  assert.equal(iosDerivedDataDir(worktree("a"), { CI: "true" }), undefined);
  const a = iosDerivedDataDir(worktree("a"), {});
  assert.match(a, /Library\/Developer\/Xcode\/DerivedData\/CrewCue-a-[0-9a-f]{8}$/);
  assert.equal(a, iosDerivedDataDir(worktree("a"), {}));
  assert.notEqual(a, iosDerivedDataDir(`/Users/y/Other/.claude/worktrees/a`, {}), "same folder name, different checkout");
});

test("heavy commands go through slot only when it is installed", () => {
  const home = mkdtempSync(path.join(tmpdir(), "crewcue-slot-"));
  try {
    const env = { HOME: home };
    assert.equal(slotAvailable(env), false);
    assert.deepEqual(slotted("swift", ["test"], { label: "x" }, env), { command: "swift", args: ["test"], queued: false });
    mkdirSync(path.join(home, ".claude", "bin"), { recursive: true });
    writeFileSync(slotPath(env), "#!/bin/sh\n");
    assert.equal(slotAvailable(env), false, "not executable");
    chmodSync(slotPath(env), 0o755);
    assert.equal(slotAvailable(env), true);
    assert.equal(slotAvailable({ ...env, CREWCUE_NO_SLOT: "1" }), false);
    assert.deepEqual(slotted("swift", ["test", "-j", "4"], { credits: 4, locks: ["spm"], label: "CrewCue tests" }, env), {
      command: slotPath(env),
      args: ["run", "--credits", "4", "--lock", "spm", "--label", "CrewCue tests", "--", "swift", "test", "-j", "4"],
      queued: true
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the old in-checkout DerivedData is deleted locally, kept in CI", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "crewcue-old-derived-"));
  try {
    const old = path.join(repo, ".agent-pr-evidence", "ios-derived", "SourcePackages");
    mkdirSync(old, { recursive: true });
    const lines = [];
    assert.equal(removeOldCheckoutDerivedData(repo, (line) => lines.push(line), { CI: "true" }), false);
    assert.equal(removeOldCheckoutDerivedData(repo, (line) => lines.push(line), {}), true);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /deleted the unused \.agent-pr-evidence\/ios-derived/);
    assert.equal(removeOldCheckoutDerivedData(repo, (line) => lines.push(line), {}), false, "nothing left to delete");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
