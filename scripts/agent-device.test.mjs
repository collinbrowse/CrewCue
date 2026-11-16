import assert from "node:assert/strict";
import { test } from "node:test";
import { androidPort, androidSerial, checkoutKey, emulatorGpu, FIRST_PORT, iosSimulatorName, PORT_SLOTS, sharedDevice, SOFTWARE_GPU } from "./lib/agentDevice.mjs";

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
