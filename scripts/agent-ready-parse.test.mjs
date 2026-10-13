#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assessPrDoneBody,
  assessReadyBody,
  countEmptyProofCells,
  pathsTouchMobile
} from "./lib/agentReadyParse.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("agent:issue:ready accepts local body files without GitHub access", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-"));
  try {
    const bodyFile = path.join(dir, "ready.md");
    fs.writeFileSync(bodyFile, completeReady);

    const result = spawnSync(process.execPath, ["scripts/agent-issue-ready.mjs", "--body-file", bodyFile], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /agent:issue:ready ready\.md/);
    assert.match(result.stdout, /PASS: Ready fields present/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("agent:pr:done body-file mode derives mobile requirement from --files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-done-"));
  try {
    const bodyFile = path.join(dir, "done.md");
    fs.writeFileSync(bodyFile, "Closes #490\n\nEC1: parser proof");

    const apiOnly = spawnSync(
      process.execPath,
      ["scripts/agent-pr-done.mjs", "--body-file", bodyFile, "--files", "services/api/src/routes/x.ts"],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(apiOnly.status, 0, apiOnly.stderr || apiOnly.stdout);
    assert.match(apiOnly.stdout, /PASS: Done checklist/);

    const mobile = spawnSync(
      process.execPath,
      ["scripts/agent-pr-done.mjs", "--body-file", bodyFile, "--files", "apps/mobile/src/App.tsx"],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(mobile.status, 1, mobile.stderr || mobile.stdout);
    assert.match(mobile.stdout, /missing: mobile sim evidence \/ blocker note/);
    assert.match(mobile.stdout, /mobile paths changed: sim evidence required/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
