#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runHook(scriptPath, payload) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    input: JSON.stringify(payload)
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("shell reminder warns on issue-less git commit", () => {
  const out = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "git commit -m 'test coverage'"
  });

  assert.equal(out.permission, "allow");
  assert.match(out.agent_message, /reference an issue \(#N\)/);
  assert.match(out.agent_message, /agent:pr:done/);
});

test("shell reminder does not warn when commit references an issue", () => {
  const out = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "git commit -m 'test coverage #492'"
  });

  assert.deepEqual(out, { permission: "allow" });
});

test("shell reminder keeps scoped verify commands quiet", () => {
  const fullVerify = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "npm run verify"
  });
  assert.match(fullVerify.agent_message, /mid-slice prefer verify:api\|mobile\|contracts/);

  const scopedVerify = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "npm run verify:api"
  });
  assert.deepEqual(scopedVerify, { permission: "allow" });
});

test("shell reminder emits iOS and Ready gate guidance", () => {
  const ios = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "npm run agent:ios:ready -- --deeplink crewcue://guest"
  });
  assert.match(ios.agent_message, /Auth0-free/);

  const ready = runHook(".cursor/hooks/shell-reminders.mjs", {
    command: "npm run agent:issue:ready -- 490"
  });
  assert.match(ready.agent_message, /Ready gate stdout/);
});

test("stop reminder emits one blocker prompt only for failed statuses", () => {
  const failed = runHook(".cursor/hooks/stop-reminders.mjs", {
    status: "failed"
  });
  assert.match(failed.followup_message, /note blocker/);

  const incomplete = runHook(".cursor/hooks/stop-reminders.mjs", {
    completion_status: "incomplete"
  });
  assert.match(incomplete.followup_message, /agent:issue:ready/);

  const success = runHook(".cursor/hooks/stop-reminders.mjs", {
    status: "success"
  });
  assert.deepEqual(success, {});
});
