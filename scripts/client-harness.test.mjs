import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(script, args) {
  return spawnSync("node", [path.join(repoRoot, script), ...args], { encoding: "utf8", cwd: repoRoot });
}

test("checklist pass requires a device proof file", () => {
  const bad = run("scripts/verify-client-behavior.mjs", []);
  assert.equal(bad.status, 0, bad.stderr);
  const dir = path.join(repoRoot, "clients/behavior");
  const indexPath = path.join(dir, "deeplinks.json");
  const original = fs.readFileSync(indexPath, "utf8");
  const index = JSON.parse(original);
  index.features[0].ios = "pass";
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  try {
    const failed = run("scripts/verify-client-behavior.mjs", []);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /pass without/);
  } finally {
    fs.writeFileSync(indexPath, original);
  }
});

test("client pr split rejects both UI trees", () => {
  const bad = run("scripts/verify-client-pr-split.mjs", ["--files", "apps/ios/CrewCue/RootView.swift", "apps/android/app/build.gradle.kts"]);
  assert.equal(bad.status, 1);
  const checklist = run("scripts/verify-client-pr-split.mjs", ["--files", "clients/behavior/hello.md"]);
  assert.equal(checklist.status, 0);
});
