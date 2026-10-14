#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  assessPrDoneBody,
  assessReadyBody,
  countEmptyProofCells
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
  assert.ok(bad.missing.some((m) => m.startsWith("Closes #<n>")));
  assert.ok(bad.missing.includes("pr-decision-doc-guard sections"));

  const stillBad = assessPrDoneBody(`Closes #490\n\n## Edge-case proofs\nEC1: script`);
  assert.equal(stillBad.ok, false);
  assert.ok(stillBad.missing.includes("pr-decision-doc-guard sections"));

  const good = assessPrDoneBody(`Closes #490\n\n## Edge-case proofs\nEC1: script\n\n${decisionGuardBody}`);
  assert.equal(good.ok, true);
});

test("assessPrDoneBody accepts No issue in place of Closes", () => {
  const r = assessPrDoneBody(`No issue: repo hygiene\nEC1: ci run\n${decisionGuardBody}`);
  assert.equal(r.ok, true);
});

test("assessPrDoneBody ignores unchecked boxes and template text for device evidence", () => {
  const template = `Closes #1\nEC1: ok\n<!-- run npm run agent:ios:ready; Blocker: explain -->\n- [ ] \`npm run test:ios\` passes\n- Blocker: _what blocked_\n${decisionGuardBody}`;
  const r = assessPrDoneBody(template, { iosChanged: true });
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => m.startsWith("ios evidence")));

  const checked = assessPrDoneBody(template.replace("- [ ]", "- [x]"), { iosChanged: true });
  assert.equal(checked.ok, true);

  const blocked = assessPrDoneBody(template.replace("_what blocked_", "Auth0 tenant unavailable on staging"), {
    iosChanged: true
  });
  assert.equal(blocked.ok, true);

  const wrongPlatform = assessPrDoneBody(template.replace("- [ ]", "- [x]"), { androidChanged: true });
  assert.equal(wrongPlatform.ok, false);
});

test("assessPrDoneBody needs a filled EC line, not the word proof", () => {
  const r = assessPrDoneBody(`Closes #1\n## Edge-case proofs\n- EC1:\nAttach proof here\n${decisionGuardBody}`);
  assert.ok(r.missing.some((m) => m.startsWith("edge-case")));
});

test("classifyNativeClientDiff reports which native trees changed", () => {
  assert.deepEqual(classifyNativeClientDiff(["apps/ios/CrewCue/RootView.swift", "apps/android/app/build.gradle.kts"]), { ios: true, android: true });
  assert.deepEqual(classifyNativeClientDiff(["clients/behavior/hello.md"]), { ios: false, android: false });
  assert.deepEqual(classifyNativeClientDiff(["apps/ios/CrewCue/RootView.swift"]), { ios: true, android: false });
});
