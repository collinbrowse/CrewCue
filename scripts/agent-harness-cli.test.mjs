#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options
  });
}

function tempMarkdown(contents) {
  const dir = mkdtempSync(path.join(tmpdir(), "crewcue-agent-harness-"));
  const file = path.join(dir, "body.md");
  writeFileSync(file, contents, "utf8");
  return file;
}

function parseJsonLine(stdout) {
  return JSON.parse(stdout.trim());
}

test("agent:issue:ready accepts a complete local body fixture", () => {
  const result = runNode([
    "scripts/agent-issue-ready.mjs",
    "--body-file",
    "scripts/fixtures/agent-ready-sample.md"
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^agent:issue:ready agent-ready-sample\.md$/m);
  assert.match(result.stdout, /^PASS: Ready fields present$/m);
  assert.ok(result.stdout.trim().split("\n").length <= 15);
});

test("agent:issue:ready rejects a local body with empty edge-case proof cells", () => {
  const body = `## Objective
Ship a gate.

## In-scope
- scripts

## Out of scope
- UI

## Acceptance criteria
- Fail empty proof.

## Edge-case matrix
| ID | Scenario | Expected | Proof |
| --- | --- | --- | --- |
| EC1 | empty proof | fail | |

## Fixtures
- body.md

## Depends on
none

## Path conflict map
scripts/

## Verification
- npm run agent:harness:test
`;
  const result = runNode(["scripts/agent-issue-ready.mjs", "--body-file", tempMarkdown(body)]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: not Ready$/m);
  assert.match(result.stdout, /^warn: 1 edge-case Proof cell\(s\) empty$/m);
  assert.ok(result.stdout.trim().split("\n").length <= 15);
});

test("agent:pr:done infers mobile evidence requirement from file paths", () => {
  const bodyFile = tempMarkdown(`Closes #490

## Edge-case proofs
- EC1: covered by scripts/agent-harness-cli.test.mjs
`);

  const apiOnly = runNode([
    "scripts/agent-pr-done.mjs",
    "--body-file",
    bodyFile,
    "--files",
    "services/api/src/routes/raceRooms.ts"
  ]);
  assert.equal(apiOnly.status, 0, apiOnly.stdout + apiOnly.stderr);
  assert.match(apiOnly.stdout, /^PASS: Done checklist$/m);

  const mobileChanged = runNode([
    "scripts/agent-pr-done.mjs",
    "--body-file",
    bodyFile,
    "--files",
    "apps/mobile/src/navigation/GuestStack.tsx"
  ]);
  assert.equal(mobileChanged.status, 1);
  assert.match(mobileChanged.stdout, /missing: mobile sim evidence \/ blocker note/);
  assert.match(mobileChanged.stdout, /mobile paths changed: sim evidence required/);
});

test("agent:pr:done accepts explicit mobile blocker evidence", () => {
  const bodyFile = tempMarkdown(`Closes #490

## Edge-case proofs
- EC1: covered by scripts/agent-harness-cli.test.mjs

## iOS simulator evidence
- Blocker: Linux runner cannot boot simulator; scoped script tests passed.
`);

  const result = runNode([
    "scripts/agent-pr-done.mjs",
    "--body-file",
    bodyFile,
    "--files",
    "apps/mobile/src/navigation/GuestStack.tsx"
  ]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^PASS: Done checklist$/m);
});

test("shell reminder hook emits targeted one-line guidance", () => {
  const commit = runNode([".cursor/hooks/shell-reminders.mjs"], {
    input: JSON.stringify({ command: "git commit -m coverage" })
  });
  assert.equal(commit.status, 0, commit.stderr);
  assert.deepEqual(parseJsonLine(commit.stdout), {
    permission: "allow",
    agent_message:
      "Reminder: prefer commits/PRs that reference an issue (#N). Run agent:pr:done before claiming Done."
  });

  const scopedVerify = runNode([".cursor/hooks/shell-reminders.mjs"], {
    input: JSON.stringify({ command: "npm run verify:api" })
  });
  assert.equal(scopedVerify.status, 0, scopedVerify.stderr);
  assert.deepEqual(parseJsonLine(scopedVerify.stdout), { permission: "allow" });
});

test("stop reminder hook only follows up for incomplete runs", () => {
  const failed = runNode([".cursor/hooks/stop-reminders.mjs"], {
    input: JSON.stringify({ status: "failed" })
  });
  assert.equal(failed.status, 0, failed.stderr);
  const failedOutput = parseJsonLine(failed.stdout);
  assert.match(failedOutput.followup_message, /Before stop: note blocker/);
  assert.match(failedOutput.followup_message, /agent:issue:ready \/ agent:pr:done/);

  const success = runNode([".cursor/hooks/stop-reminders.mjs"], {
    input: JSON.stringify({ status: "completed" })
  });
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(parseJsonLine(success.stdout), {});
});
