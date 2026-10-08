#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runScript(script, args) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts", script), ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function withBodyFile(body, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "crewcue-agent-harness-"));
  const file = path.join(dir, "body.md");
  try {
    writeFileSync(file, body);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const doneBody = `Closes #490

## Edge-case proofs
EC1: scripts/agent-ready-parse.test.mjs
`;

test("agent:pr:done body-file infers mobile evidence requirement from changed files", () => {
  withBodyFile(doneBody, (file) => {
    const apiOnly = runScript("agent-pr-done.mjs", [
      "--body-file",
      file,
      "--files",
      "services/api/src/routes/foo.ts"
    ]);
    assert.equal(apiOnly.status, 0, apiOnly.stderr);
    assert.match(apiOnly.stdout, /PASS: Done checklist/);

    const mobileChanged = runScript("agent-pr-done.mjs", [
      "--body-file",
      file,
      "--files",
      "apps/mobile/src/navigation/GuestStack.tsx"
    ]);
    assert.equal(mobileChanged.status, 1);
    assert.match(mobileChanged.stdout, /mobile sim evidence \/ blocker note/);
    assert.match(mobileChanged.stdout, /mobile paths changed/);
  });
});

test("agent:pr:done --mobile override requires simulator evidence for body-file checks", () => {
  withBodyFile(doneBody, (file) => {
    const missingEvidence = runScript("agent-pr-done.mjs", ["--body-file", file, "--mobile"]);
    assert.equal(missingEvidence.status, 1);
    assert.match(missingEvidence.stdout, /mobile sim evidence \/ blocker note/);

    writeFileSync(file, `${doneBody}\nSimulator proof: npm run agent:ios:ready\n`);
    const withEvidence = runScript("agent-pr-done.mjs", ["--body-file", file, "--mobile"]);
    assert.equal(withEvidence.status, 0, withEvidence.stderr);
    assert.match(withEvidence.stdout, /PASS: Done checklist/);
  });
});

test("agent:issue:ready body-file passes complete issue and fails missing ready fields", () => {
  const complete = runScript("agent-issue-ready.mjs", [
    "--body-file",
    "scripts/fixtures/agent-ready-sample.md"
  ]);
  assert.equal(complete.status, 0, complete.stderr);
  assert.match(complete.stdout, /PASS: Ready fields present/);

  withBodyFile("## Objective\nShip it.\n", (file) => {
    const incomplete = runScript("agent-issue-ready.mjs", ["--body-file", file]);
    assert.equal(incomplete.status, 1);
    assert.match(incomplete.stdout, /FAIL: not Ready/);
    assert.match(incomplete.stdout, /missing:/);
  });
});
