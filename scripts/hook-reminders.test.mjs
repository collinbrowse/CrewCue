#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellReminderHook = path.join(repoRoot, ".cursor/hooks/shell-reminders.mjs");
const stopReminderHook = path.join(repoRoot, ".cursor/hooks/stop-reminders.mjs");

function runHook(script, payload) {
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    encoding: "utf8",
    input: JSON.stringify(payload)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("shell reminder hook keeps commands allowed and warns on issue-less commits", () => {
  const reminded = runHook(shellReminderHook, { command: 'git commit -m "coverage tests"' });
  assert.equal(reminded.permission, "allow");
  assert.match(reminded.agent_message, /issue \(#N\)/);
  assert.match(reminded.agent_message, /agent:pr:done/);

  const withIssue = runHook(shellReminderHook, { command: 'git commit -m "coverage tests #123"' });
  assert.deepEqual(withIssue, { permission: "allow" });
});

test("shell reminder hook distinguishes full verify from scoped verify", () => {
  const fullVerify = runHook(shellReminderHook, { command: "npm run verify" });
  assert.equal(fullVerify.permission, "allow");
  assert.match(fullVerify.agent_message, /full verify at pre-PR/);

  const scopedVerify = runHook(shellReminderHook, { command: "npm run verify:api" });
  assert.deepEqual(scopedVerify, { permission: "allow" });
});

test("shell reminder hook emits iOS and Ready gate guidance", () => {
  const ios = runHook(shellReminderHook, { command: "npm run agent:ios:ready -- --deeplink crewcue://dev/pace-estimate" });
  assert.equal(ios.permission, "allow");
  assert.match(ios.agent_message, /Auth0-free/);
  assert.match(ios.agent_message, /pace-estimate/);

  const ready = runHook(shellReminderHook, { command: "npm run agent:issue:ready -- 490" });
  assert.equal(ready.permission, "allow");
  assert.match(ready.agent_message, /Ready gate stdout/);
});

test("stop reminder hook only follows up for failed or incomplete status", () => {
  const failed = runHook(stopReminderHook, { status: "failed" });
  assert.match(failed.followup_message, /note blocker/);
  assert.match(failed.followup_message, /agent:issue:ready/);

  const incomplete = runHook(stopReminderHook, { completion_status: "incomplete" });
  assert.match(incomplete.followup_message, /agent:pr:done/);

  const completed = runHook(stopReminderHook, { status: "completed" });
  assert.deepEqual(completed, {});
});
