import assert from "node:assert/strict";
import { test } from "node:test";
import { androidPort, androidSerial, checkoutKey, FIRST_PORT, iosSimulatorName, PORT_SLOTS, sharedDevice } from "./lib/agentDevice.mjs";

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

test("CI and the opt-out share devices", () => {
  assert.equal(sharedDevice({}), false);
  assert.equal(sharedDevice({ CI: "true" }), true);
  assert.equal(sharedDevice({ CREWCUE_SHARED_DEVICE: "1" }), true);
});
