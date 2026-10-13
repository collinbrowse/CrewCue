#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assessPrDecisionDoc } from "./lib/prDecisionDocGuard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "scripts/pr-decision-doc-guard.mjs");
const templatePath = path.join(repoRoot, ".github/pull_request_template.md");

const filled = `## Decision Tree and Rationale
- Decision: Put the guard in always-on rules and agent:pr:done
  - Context: Agents skipped CI-only docs
  - Alternatives considered: Requestable workflow rule only
  - Why selected: Machine gate plus a named always-on doc

## Implicit Assumptions and Invariants
- Assumption: Template headers stay exact matches
  - Why it is safe today: CI and Done share scripts/lib/prDecisionDocGuard.mjs
  - What would break if false: Guard false-fails or false-passes

## Higher-Order Effects Check
- Summary: Summary-only gh pr create --body fails locally before CI
`;

test("assessPrDecisionDoc passes filled bullets", () => {
  const r = assessPrDecisionDoc(filled);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test("assessPrDecisionDoc accepts Single obvious path and None identified as bullet values", () => {
  const r = assessPrDecisionDoc(`## Decision Tree and Rationale
- Decision: Single obvious path; no meaningful alternatives.

## Implicit Assumptions and Invariants
- Assumption: None identified.

## Higher-Order Effects Check
- Summary: None identified.
`);
  assert.equal(r.ok, true);
});

test("assessPrDecisionDoc accepts bold labels", () => {
  const r = assessPrDecisionDoc(`## Decision Tree and Rationale
- **Decision:** Ship shared checker

## Implicit Assumptions and Invariants
- **Assumption:** Headers remain exact

## Higher-Order Effects Check
- **Summary:** Done gate matches CI
`);
  assert.equal(r.ok, true);
});

test("assessPrDecisionDoc normalizes unicode dashes in headers", () => {
  const r = assessPrDecisionDoc(`## Decision Tree and Rationale
- Decision: ok

## Implicit Assumptions and Invariants
- Assumption: ok

## Higher\u2013Order Effects Check
- Summary: ok
`);
  assert.equal(r.ok, true);
});

test("assessPrDecisionDoc fails Summary-only body", () => {
  const r = assessPrDecisionDoc("## Summary\n- ship it\n\n## Test plan\n- test");
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("## Decision Tree and Rationale"));
  assert.ok(r.missing.includes("- Decision:"));
});

test("assessPrDecisionDoc fails empty Decision bullet", () => {
  const r = assessPrDecisionDoc(`## Decision Tree and Rationale
- Decision:

## Implicit Assumptions and Invariants
- Assumption: listed

## Higher-Order Effects Check
- Summary: listed
`);
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("- Decision:"));
  assert.equal(r.missing.includes("- Assumption:"), false);
});

test("assessPrDecisionDoc fails unfilled pull_request_template.md", () => {
  const r = assessPrDecisionDoc(fs.readFileSync(templatePath, "utf8"));
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("- Decision:"));
  assert.ok(r.missing.includes("- Assumption:"));
  assert.ok(r.missing.includes("- Summary:"));
});

test("assessPrDecisionDoc ignores comment and instruction phrases", () => {
  const r = assessPrDecisionDoc(`## Decision Tree and Rationale
<!-- Single obvious path -->

## Implicit Assumptions and Invariants
Do not treat a paragraph None identified as a filled bullet.

## Higher-Order Effects Check
If none, set \`- Summary: None identified.\`
`);
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("- Decision:"));
  assert.ok(r.missing.includes("- Assumption:"));
  assert.ok(r.missing.includes("- Summary:"));
});

test("CLI fails unfilled body-file and passes filled", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-decision-doc-"));
  const badPath = path.join(dir, "bad.md");
  const goodPath = path.join(dir, "good.md");
  fs.writeFileSync(badPath, "## Summary\nnope\n");
  fs.writeFileSync(goodPath, filled);

  const bad = spawnSync(process.execPath, [cli, "--body-file", badPath], { encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stdout, /missing required section headers/);

  const good = spawnSync(process.execPath, [cli, "--body-file", goodPath], { encoding: "utf8" });
  assert.equal(good.status, 0);
  assert.match(good.stdout, /guard passed/);
});
