import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(script, args, env = {}) {
  return spawnSync("node", [path.join(repoRoot, script), ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    env: { ...process.env, ...env }
  });
}

/** Copies clients/behavior to a temp dir with one feature row set to fail on both platforms. */
function behaviorCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewcue-behavior-"));
  fs.cpSync(path.join(repoRoot, "clients/behavior"), dir, { recursive: true });
  const indexPath = path.join(dir, "deeplinks.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const row = index.features[0];
  row.ios = "fail";
  row.android = "fail";
  fs.rmSync(path.join(dir, "proofs", `${row.id}.ios.json`), { force: true });
  fs.rmSync(path.join(dir, "proofs", `${row.id}.android.json`), { force: true });
  const write = () => fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  write();
  return { dir, row, write };
}

function verify(dir) {
  return run("scripts/verify-client-behavior.mjs", [], { CREWCUE_BEHAVIOR_DIR: dir });
}

function fullProof(row) {
  return {
    id: row.id,
    platform: "ios",
    entry: row.entry,
    device: "iPhone 18 Pro simulator, iOS 27.0",
    commit: "abc1234",
    action: "Opened the entry deeplink.",
    checked: { Success: "seen", Empty: "seen", Error: "seen", Offline: "seen" }
  };
}

test("repo checklists pass the behavior gate", () => {
  const result = run("scripts/verify-client-behavior.mjs", []);
  assert.equal(result.status, 0, result.stderr);
});

test("checklist pass requires a device proof file", () => {
  const { dir, row, write } = behaviorCopy();
  row.ios = "pass";
  write();
  const failed = verify(dir);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /pass without a usable proofs\/.+\.ios\.json \(missing\)/);
});

test("a proof must record every checklist state and match the row", () => {
  const { dir, row, write } = behaviorCopy();
  row.ios = "pass";
  write();
  fs.mkdirSync(path.join(dir, "proofs"), { recursive: true });
  const proofPath = path.join(dir, "proofs", `${row.id}.ios.json`);

  const missingOffline = fullProof(row);
  delete missingOffline.checked.Offline;
  fs.writeFileSync(proofPath, JSON.stringify(missingOffline));
  assert.match(verify(dir).stderr, /checked\.Offline is empty/);

  fs.writeFileSync(proofPath, JSON.stringify({ ...fullProof(row), entry: "crewcue://dev/other" }));
  assert.match(verify(dir).stderr, /entry crewcue:\/\/dev\/other/);

  fs.writeFileSync(proofPath, JSON.stringify(fullProof(row)));
  const ok = verify(dir);
  assert.equal(ok.status, 0, ok.stderr);
});

test("a proof file must name a feature row", () => {
  const { dir } = behaviorCopy();
  fs.mkdirSync(path.join(dir, "proofs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "proofs", "map-track.web.json"), "{}");
  const failed = verify(dir);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /proofs\/map-track\.web\.json does not name a feature row/);
});
