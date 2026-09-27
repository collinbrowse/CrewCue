#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellHook = path.join(repoRoot, ".cursor/hooks/shell-reminders.mjs");
const stopHook = path.join(repoRoot, ".cursor/hooks/stop-reminders.mjs");

function runHook(scriptPath, payload) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    input: JSON.stringify(payload)
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("shell reminder allows commands without a reminder by default", () => {
  assert.deepEqual(runHook(shellHook, { command: "npm run verify:api" }), {
    permission: "allow"
  });
});

test("shell reminder flags commits without issue references", () => {
  const out = runHook(shellHook, { command: 'git commit -m "add coverage"' });
  assert.equal(out.permission, "allow");
  assert.match(out.agent_message, /reference an issue \(#N\)/);

  assert.deepEqual(runHook(shellHook, { command: 'git commit -m "add coverage #123"' }), {
    permission: "allow"
  });
});

test("shell reminder nudges full verify toward scoped mid-slice checks", () => {
  const out = runHook(shellHook, { command: "npm run verify" });
  assert.equal(out.permission, "allow");
  assert.match(out.agent_message, /verify:api\|mobile\|contracts/);
});

test("shell reminder explains agent-specific gate shortcuts", () => {
  assert.match(
    runHook(shellHook, { command: "npm run agent:issue:ready -- 490" }).agent_message,
    /Ready gate stdout/
  );
  assert.match(
    runHook(shellHook, { command: "npm run agent:ios:ready" }).agent_message,
    /Auth0-free/
  );
});

test("stop reminder emits a concise blocker prompt only for unfinished runs", () => {
  assert.match(runHook(stopHook, { status: "failed" }).followup_message, /note blocker/);
  assert.match(runHook(stopHook, { completion_status: "incomplete" }).followup_message, /agent:pr:done/);
  assert.deepEqual(runHook(stopHook, { status: "success" }), {});
});
