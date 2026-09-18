#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

test("agent-pr-done CLI infers mobile simulator requirement from --body-file --files", () => {
  const dir = mkdtempSync(join(tmpdir(), "crewcue-agent-done-"));
  try {
    const bodyFile = join(dir, "pr-body.md");
    writeFileSync(bodyFile, "Closes #490\n\n## Edge-case proofs\nEC1: covered by tests\n", "utf8");

    const apiOnly = spawnSync(
      process.execPath,
      ["scripts/agent-pr-done.mjs", "--body-file", bodyFile, "--files", "services/api/src/routes/raceRooms.ts"],
      { encoding: "utf8" }
    );
    assert.equal(apiOnly.status, 0, apiOnly.stdout + apiOnly.stderr);
    assert.match(apiOnly.stdout, /PASS: Done checklist/);

    const mobileMissingEvidence = spawnSync(
      process.execPath,
      ["scripts/agent-pr-done.mjs", "--body-file", bodyFile, "--files", "apps/mobile/src/navigation/GuestStack.tsx"],
      { encoding: "utf8" }
    );
    assert.equal(mobileMissingEvidence.status, 1);
    assert.match(mobileMissingEvidence.stdout, /mobile sim evidence \/ blocker note/);
    assert.match(mobileMissingEvidence.stdout, /mobile paths changed: sim evidence required/);

    writeFileSync(
      bodyFile,
      "Closes #490\n\n## Edge-case proofs\nEC1: covered by tests\n\nsimulator: Blocker - Linux runner cannot boot iOS.\n",
      "utf8"
    );
    const mobileWithEvidence = spawnSync(
      process.execPath,
      ["scripts/agent-pr-done.mjs", "--body-file", bodyFile, "--files", "apps/mobile/src/navigation/GuestStack.tsx"],
      { encoding: "utf8" }
    );
    assert.equal(mobileWithEvidence.status, 0, mobileWithEvidence.stdout + mobileWithEvidence.stderr);
    assert.match(mobileWithEvidence.stdout, /PASS: Done checklist/);
    assert.match(mobileWithEvidence.stdout, /mobile paths changed: sim evidence required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
