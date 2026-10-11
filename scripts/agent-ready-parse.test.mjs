#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assessPrDoneBody,
  assessReadyBody,
  countEmptyProofCells,
  pathsTouchMobile
} from "./lib/agentReadyParse.mjs";

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

function writeTempPrBody(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewcue-pr-done-"));
  const file = path.join(dir, "body.md");
  fs.writeFileSync(file, body, "utf8");
  return { dir, file };
}

function runPrDone(args) {
  return spawnSync(process.execPath, ["scripts/agent-pr-done.mjs", ...args], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8"
  });
}

test("agent-pr-done CLI infers mobile evidence requirement from --files", () => {
  const { dir, file } = writeTempPrBody(`Closes #490\n\n## Edge-case proofs\nEC1: parser covered\n`);
  try {
    const result = runPrDone([
      "--body-file",
      file,
      "--files",
      "services/api/src/routes/pacingEstimates.ts",
      "apps/mobile/src/features/schedule/CrewScheduleSheetScreen.tsx"
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /agent:pr:done body\.md/);
    assert.match(result.stdout, /missing: mobile sim evidence \/ blocker note/);
    assert.match(result.stdout, /mobile paths changed: sim evidence required/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("agent-pr-done CLI allows mobile --files when body includes simulator evidence", () => {
  const { dir, file } = writeTempPrBody(
    `Closes #490\n\n## Edge-case proofs\nEC1: parser covered\n\nsnapshot_ui: schedule sheet visible\n`
  );
  try {
    const result = runPrDone([
      "--body-file",
      file,
      "--files",
      "packages/mobile-wrapper/apps/mobile/App.tsx"
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS: Done checklist/);
    assert.match(result.stdout, /mobile paths changed: sim evidence required/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
