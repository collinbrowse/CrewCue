#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runHook(relativePath, payload) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, relativePath)], {
    cwd: repoRoot,
    encoding: "utf8",
    input: JSON.stringify(payload)
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("shell reminder nudges issue references before commits without one", () => {
  const missingIssue = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "git commit -m 'Add harness tests'"
  });
  assert.match(missingIssue.agent_message, /reference an issue/);
  assert.equal(missingIssue.permission, "allow");

  const withIssue = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "git commit -m 'Add harness tests (#490)'"
  });
  assert.equal(withIssue.agent_message, undefined);
  assert.equal(withIssue.permission, "allow");
});

test("shell reminder distinguishes scoped and full verification commands", () => {
  const fullVerify = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "npm run verify"
  });
  assert.match(fullVerify.agent_message, /mid-slice prefer verify:api\|mobile\|contracts/);

  const scopedVerify = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "npm run verify:api"
  });
  assert.equal(scopedVerify.agent_message, undefined);
});

test("shell reminder advertises Ready and iOS shortcut guidance", () => {
  const ready = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "npm run agent:issue:ready -- 490"
  });
  assert.match(ready.agent_message, /Ready gate stdout/);

  const ios = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "npm run agent:ios:ready -- --deeplink crewcue://dev/pace-estimate"
  });
  assert.match(ios.agent_message, /Auth0-free/);
});

test("stop reminder emits blocker guidance only for unsuccessful statuses", () => {
  const failed = runHook(".cursor/hooks/stop-reminders.mjs", { status: "failed" });
  assert.match(failed.followup_message, /note blocker/);

  const incomplete = runHook(".cursor/hooks/stop-reminders.mjs", {
    completion_status: "incomplete"
  });
  assert.match(incomplete.followup_message, /agent:pr:done/);

  const success = runHook(".cursor/hooks/stop-reminders.mjs", { status: "success" });
  assert.equal(success.followup_message, undefined);
});
