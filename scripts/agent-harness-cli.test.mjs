#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runScript(scriptName, args) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts", scriptName), ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function writeTempBody(t, contents) {
  const dir = mkdtempSync(path.join(tmpdir(), "crewcue-agent-harness-"));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const file = path.join(dir, "body.md");
  writeFileSync(file, contents);
  return file;
}

const doneBody = `Closes #490

## Edge-case proofs

EC1: script-level proof
`;

const readyBodyWithEmptyProof = `## Objective
Ship harness checks.

## In-scope changes
- scripts/

## Out of scope
Auth0 accounts

## Acceptance criteria
- Ready script reports missing proof cells.

## Edge-case matrix
| ID | Scenario | Expected | Proof |
| --- | --- | --- | --- |
| EC1 | Missing proof | fail | |

## Fixtures
- local markdown body

## Depends on
none

## Path conflict map
scripts/

## Verification
- npm run agent:issue:ready -- --body-file body.md
`;

test("agent-pr-done body-file mode passes non-mobile file changes without simulator evidence", (t) => {
  const bodyFile = writeTempBody(t, doneBody);

  const result = runScript("agent-pr-done.mjs", [
    "--body-file",
    bodyFile,
    "--files",
    "services/api/src/routes/raceRooms.ts"
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS: Done checklist/);
  assert.doesNotMatch(result.stdout, /mobile paths changed/);
});

test("agent-pr-done body-file mode infers nested mobile file changes from --files", (t) => {
  const bodyFile = writeTempBody(t, doneBody);

  const result = runScript("agent-pr-done.mjs", [
    "--body-file",
    bodyFile,
    "--files",
    "fixtures/examples/apps/mobile/src/App.tsx"
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL: Done incomplete/);
  assert.match(result.stdout, /missing: mobile sim evidence \/ blocker note/);
  assert.match(result.stdout, /mobile paths changed: sim evidence required/);
});

test("agent-issue-ready body-file mode fails incomplete edge-case proof cells", (t) => {
  const bodyFile = writeTempBody(t, readyBodyWithEmptyProof);

  const result = runScript("agent-issue-ready.mjs", ["--body-file", bodyFile]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL: not Ready/);
  assert.match(result.stdout, /warn: 1 edge-case Proof cell\(s\) empty/);
});
