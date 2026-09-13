#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assessPrDoneBody,
  assessReadyBody,
  countEmptyProofCells,
  pathsTouchMobile
} from "./lib/agentReadyParse.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runHarnessScript(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function outputLineCount(output) {
  return output
    .trim()
    .split("\n")
    .filter(Boolean).length;
}

function writeTempMarkdown(body) {
  const dir = mkdtempSync(path.join(tmpdir(), "crewcue-agent-harness-"));
  const file = path.join(dir, "body.md");
  writeFileSync(file, body, "utf8");
  return file;
}

const completeReady = `## Objective
Ship harness.

## In-scope changes
- scripts/

## Out of scope
Auth0 accounts

## Acceptance criteria
1. Ready script works

## Edge-case matrix
| ID | Scenario | Expected | Proof |
| --- | --- | --- | --- |
| EC1 | missing acceptance | fail | scripts/agent-issue-ready.test.mjs |

## Fixtures
- scripts/fixtures/agent-ready-sample.md

## Depends on
none

## Path conflict map
scripts/

## Verification
- npm run agent:issue:ready -- 1
`;

test("assessReadyBody passes complete body", () => {
  const r = assessReadyBody(completeReady);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test("assessReadyBody fails missing acceptance", () => {
  const body = completeReady.replace(/## Acceptance criteria[\s\S]*?(?=## Edge)/, "");
  const r = assessReadyBody(body);
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("acceptance"));
});

test("countEmptyProofCells finds blanks", () => {
  const body = `## Edge-case matrix
| ID | Scenario | Expected | Proof |
| --- | --- | --- | --- |
| EC1 | x | y | |
| EC2 | a | b | scripts/foo.test.ts |
`;
  assert.equal(countEmptyProofCells(body), 1);
});

test("assessPrDoneBody requires Closes and edge proof", () => {
  const bad = assessPrDoneBody("## Summary\nhello");
  assert.equal(bad.ok, false);
  assert.ok(bad.missing.includes("Closes #<n>"));

  const good = assessPrDoneBody(`Closes #490\n\n## Edge-case proofs\nEC1: script`);
  assert.equal(good.ok, true);
});

test("assessPrDoneBody requires sim note when mobile changed", () => {
  const r = assessPrDoneBody(`Closes #1\nEC1 ok`, { mobileChanged: true });
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => m.includes("sim")));

  const ok = assessPrDoneBody(`Closes #1\nEC1 ok\nsimulator: Blocker Auth0`, {
    mobileChanged: true
  });
  assert.equal(ok.ok, true);
});

test("pathsTouchMobile", () => {
  assert.equal(pathsTouchMobile(["services/api/src/x.ts"]), false);
  assert.equal(pathsTouchMobile(["apps/mobile/App.tsx"]), true);
});

test("agent:issue:ready CLI validates body-file fixtures and keeps output short", () => {
  const pass = runHarnessScript("scripts/agent-issue-ready.mjs", [
    "--body-file=scripts/fixtures/agent-ready-sample.md"
  ]);
  assert.equal(pass.status, 0, pass.stderr || pass.stdout);
  assert.match(pass.stdout, /agent:issue:ready agent-ready-sample\.md/);
  assert.match(pass.stdout, /PASS: Ready fields present/);
  assert.ok(outputLineCount(pass.stdout) <= 15);

  const fail = runHarnessScript("scripts/agent-issue-ready.mjs", [
    "--body-file",
    writeTempMarkdown("## Objective\nToo thin.\n")
  ]);
  assert.equal(fail.status, 1, fail.stderr || fail.stdout);
  assert.match(fail.stdout, /FAIL: not Ready/);
  assert.match(fail.stdout, /missing: .*acceptance/);
  assert.ok(outputLineCount(fail.stdout) <= 15);
});

test("agent:pr:done CLI enforces mobile evidence from --files", () => {
  const pass = runHarnessScript("scripts/agent-pr-done.mjs", [
    "--body-file",
    "scripts/fixtures/agent-pr-done-sample.md",
    "--files",
    "apps/mobile/src/navigation/GuestStack.tsx"
  ]);
  assert.equal(pass.status, 0, pass.stderr || pass.stdout);
  assert.match(pass.stdout, /agent:pr:done agent-pr-done-sample\.md/);
  assert.match(pass.stdout, /PASS: Done checklist/);
  assert.match(pass.stdout, /mobile paths changed: sim evidence required/);
  assert.ok(outputLineCount(pass.stdout) <= 15);

  const fail = runHarnessScript("scripts/agent-pr-done.mjs", [
    "--body-file",
    writeTempMarkdown("Closes #490\n\n## Edge-case proofs\nEC1: covered\n"),
    "--files",
    "apps/mobile/src/navigation/GuestStack.tsx"
  ]);
  assert.equal(fail.status, 1, fail.stderr || fail.stdout);
  assert.match(fail.stdout, /FAIL: Done incomplete/);
  assert.match(fail.stdout, /mobile sim evidence \/ blocker note/);
  assert.ok(outputLineCount(fail.stdout) <= 15);
});
