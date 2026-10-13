#!/usr/bin/env node
import assert from "node:assert/strict";
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

test("assessReadyBody accepts documented heading aliases", () => {
  const body = completeReady
    .replace("## In-scope changes", "## Scope")
    .replace("## Path conflict map", "## Conflicts with")
    .replace("## Verification", "## Verification commands");

  const r = assessReadyBody(body);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
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

test("countEmptyProofCells flags dash placeholders and stops at next section", () => {
  const body = `## Edge-case matrix
| ID | Scenario | Expected | Proof |
| --- | --- | --- | --- |
| EC1 | x | y | - |
| EC2 | a | b | \u2014 |
| EC3 | ok | ok | scripts/foo.test.ts |

## Fixtures
| not | an | edge | matrix |
| --- | --- | --- | --- |
| row | should | not | count |
`;
  assert.equal(countEmptyProofCells(body), 2);
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
  for (const keyword of ["Fixes", "Resolves"]) {
    const r = assessPrDoneBody(`${keyword} #490\n\nProof: EC1 covered`, {
      mobileChanged: false
    });
    assert.equal(r.ok, true, `${keyword} should satisfy linked issue requirement`);
  }

  const mobile = assessPrDoneBody(`Resolves #490\n\nEC1: snapshot_ui verified`, {
    mobileChanged: true
  });
  assert.equal(mobile.ok, true);
});

test("pathsTouchMobile", () => {
  assert.equal(pathsTouchMobile(["services/api/src/x.ts"]), false);
  assert.equal(pathsTouchMobile(["apps/mobile/App.tsx"]), true);
  assert.equal(pathsTouchMobile(["/tmp/worktree/apps/mobile/src/App.tsx"]), true);
  assert.equal(pathsTouchMobile(["docs/apps/mobile-guide.md"]), false);
});
