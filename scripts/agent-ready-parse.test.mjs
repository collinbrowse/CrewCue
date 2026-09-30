#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const readyWithAcceptedAliases = `## Objective
Ship harness.

## Scope
- scripts/

## Out of scope
Auth0 accounts

## Acceptance criteria
1. Ready script works

## Edge case matrix
| ID | Scenario | Expected | Proof |
| --- | --- | --- | --- |
| EC1 | alias headings | pass | scripts/agent-ready-parse.test.mjs |

## Fixtures
- scripts/fixtures/agent-ready-sample.md

## Depends on
none

## Path conflicts map
scripts/

## Verification commands
- npm run agent:issue:ready -- 1
`;

function withTempMarkdown(contents, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "crewcue-agent-ready-"));
  const file = path.join(dir, "body.md");
  writeFileSync(file, contents);
  try {
    return run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

test("assessReadyBody accepts issue-form heading aliases", () => {
  const r = assessReadyBody(readyWithAcceptedAliases);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test("assessReadyBody fails placeholder proof cells", () => {
  const body = completeReady.replace("scripts/agent-issue-ready.test.mjs", "-");
  const r = assessReadyBody(body);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, []);
  assert.ok(r.warnings.some((warning) => warning.includes("Proof cell")));
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

test("assessPrDoneBody accepts alternate close keywords and snapshot_ui mobile proof", () => {
  const r = assessPrDoneBody(`Resolves #42\n\n## Edge-case proofs\nEC1: snapshot_ui captured`, {
    mobileChanged: true
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test("pathsTouchMobile", () => {
  assert.equal(pathsTouchMobile(["services/api/src/x.ts"]), false);
  assert.equal(pathsTouchMobile(["apps/mobile/App.tsx"]), true);
  assert.equal(pathsTouchMobile(["packages/fixture/apps/mobile/App.tsx"]), true);
});

test("agent:issue:ready --body-file evaluates local Ready body", () => {
  withTempMarkdown(readyWithAcceptedAliases, (bodyFile) => {
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts/agent-issue-ready.mjs"),
      "--body-file",
      bodyFile
    ], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS: Ready fields present/);
  });
});

test("agent:pr:done --body-file infers mobile files and accepts simulator evidence", () => {
  withTempMarkdown(`Fixes #77\n\n## Edge-case proofs\nEC1: snapshot_ui captured`, (bodyFile) => {
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts/agent-pr-done.mjs"),
      "--body-file",
      bodyFile,
      "--files",
      "packages/fixture/apps/mobile/App.tsx"
    ], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS: Done checklist/);
    assert.match(result.stdout, /mobile paths changed/);
  });
});
