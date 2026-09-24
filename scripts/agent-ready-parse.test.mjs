#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  assessPrDoneBody,
  assessReadyBody,
  countEmptyProofCells,
  pathsTouchMobile
} from "./lib/agentReadyParse.mjs";
import { classifyNativeClientDiff } from "./lib/clientSplit.mjs";

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

const decisionGuardBody = `## Decision Tree and Rationale
- Decision: Enforce the template via agent:pr:done
  - Context: CI-only docs were skipped
  - Alternatives considered: Optional workflow rule
  - Why selected: Shared checker

## Implicit Assumptions and Invariants
- Assumption: Headers stay exact
  - Why it is safe today: Shared lib
  - What would break if false: Guard drift

## Higher-Order Effects Check
- Summary: Done gate fails without the three sections
`;

test("assessPrDoneBody requires Closes, edge proof, and decision guard", () => {
  const bad = assessPrDoneBody("## Summary\nhello");
  assert.equal(bad.ok, false);
  assert.ok(bad.missing.includes("Closes #<n>"));
  assert.ok(bad.missing.includes("pr-decision-doc-guard sections"));

  const stillBad = assessPrDoneBody(`Closes #490\n\n## Edge-case proofs\nEC1: script`);
  assert.equal(stillBad.ok, false);
  assert.ok(stillBad.missing.includes("pr-decision-doc-guard sections"));

  const good = assessPrDoneBody(`Closes #490\n\n## Edge-case proofs\nEC1: script\n\n${decisionGuardBody}`);
  assert.equal(good.ok, true);
});

test("assessPrDoneBody requires sim note when mobile changed", () => {
  const r = assessPrDoneBody(`Closes #1\nEC1 ok\n${decisionGuardBody}`, { mobileChanged: true });
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => m.includes("sim")));

  const ok = assessPrDoneBody(`Closes #1\nEC1 ok\nsimulator: Blocker Auth0\n${decisionGuardBody}`, {
    mobileChanged: true
  });
  assert.equal(ok.ok, true);
});

test("pathsTouchMobile", () => {
  assert.equal(pathsTouchMobile(["services/api/src/x.ts"]), false);
  assert.equal(pathsTouchMobile(["apps/mobile/App.tsx"]), true);
});

test("classifyNativeClientDiff rejects both UI trees", () => {
  assert.equal(classifyNativeClientDiff(["apps/ios/CrewCue/RootView.swift", "apps/android/app/build.gradle.kts"]).splitViolation, true);
  assert.equal(classifyNativeClientDiff(["clients/behavior/hello.md"]).splitViolation, false);
  assert.equal(classifyNativeClientDiff(["apps/ios/CrewCue/RootView.swift"]).splitViolation, false);
});
