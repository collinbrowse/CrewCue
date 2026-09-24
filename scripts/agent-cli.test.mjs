#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runScript(scriptName, args) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts", scriptName), ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function assertStdoutContract(stdout) {
  const lines = stdout.trimEnd().split("\n").filter(Boolean);
  assert.ok(lines.length <= 15, `expected at most 15 stdout lines, got ${lines.length}`);
}

test("agent:issue:ready CLI accepts a complete body file", () => {
  const result = runScript("agent-issue-ready.mjs", [
    "--body-file",
    "scripts/fixtures/agent-ready-sample.md"
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agent:issue:ready agent-ready-sample\.md/);
  assert.match(result.stdout, /PASS: Ready fields present/);
  assertStdoutContract(result.stdout);
});

test("agent:issue:ready CLI reports missing Ready sections with a failing exit code", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crewcue-ready-"));
  const bodyFile = path.join(tmpDir, "missing-acceptance.md");
  fs.writeFileSync(
    bodyFile,
    `## Objective
Ship a change.

## In-scope changes
- scripts/

## Out of scope
None

## Edge-case matrix
| ID | Scenario | Expected | Proof |
| --- | --- | --- | --- |
| EC1 | proof | pass | scripts/agent-cli.test.mjs |

## Fixtures
- temp

## Depends on
none

## Path conflict map
none

## Verification
- npm run agent:harness:test
`
  );

  try {
    const result = runScript("agent-issue-ready.mjs", ["--body-file", bodyFile]);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: not Ready/);
    assert.match(result.stdout, /missing: acceptance/);
    assertStdoutContract(result.stdout);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("agent:pr:done CLI infers mobile evidence from changed file paths", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crewcue-done-"));
  const bodyFile = path.join(tmpDir, "done-without-sim.md");
  fs.writeFileSync(
    bodyFile,
    `Closes #490

## Edge-case proofs
- EC1: scripts/agent-cli.test.mjs
`
  );

  try {
    const apiOnly = runScript("agent-pr-done.mjs", [
      "--body-file",
      bodyFile,
      "--files",
      "services/api/src/routes/raceRooms.ts"
    ]);
    assert.equal(apiOnly.status, 0, apiOnly.stderr);
    assert.match(apiOnly.stdout, /PASS: Done checklist/);
    assertStdoutContract(apiOnly.stdout);

    const mobile = runScript("agent-pr-done.mjs", [
      "--body-file",
      bodyFile,
      "--files",
      "apps/mobile/src/navigation/GuestStack.tsx"
    ]);
    assert.equal(mobile.status, 1);
    assert.match(mobile.stdout, /FAIL: Done incomplete/);
    assert.match(mobile.stdout, /mobile sim evidence \/ blocker note/);
    assert.match(mobile.stdout, /mobile paths changed: sim evidence required/);
    assertStdoutContract(mobile.stdout);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
