import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(script, args) {
  return spawnSync("node", [path.join(repoRoot, script), ...args], { encoding: "utf8", cwd: repoRoot });
}

test("client pr split rejects both UI trees", () => {
  const bad = run("scripts/verify-client-pr-split.mjs", ["--files", "apps/ios/CrewCue/RootView.swift", "apps/android/app/build.gradle.kts"]);
  assert.equal(bad.status, 1);
  const checklist = run("scripts/verify-client-pr-split.mjs", ["--files", "clients/behavior/hello.md"]);
  assert.equal(checklist.status, 0);
});
