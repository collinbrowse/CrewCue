import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { blockReason, PRODUCTION_ENVIRONMENT_ID } from "../.claude/hooks/release-guard.mjs";

const STAGING = "ab4e6b16-5a12-4470-b8ef-c04eeede3fed";
const bash = (command) => blockReason("Bash", { command });

test("blocks release tags, release runs and deployment approvals", () => {
  for (const command of [
    "git tag v1.0.0",
    "git tag -a v1.0.0 -m release",
    "git tag -d v1.0.0",
    "git push origin v1.0.0",
    "git push --tags",
    "git push --follow-tags origin claude/x",
    "git push origin refs/tags/v1.0.0",
    "git push origin :v1.0.0",
    "npm run release -- 1.0.0",
    "node scripts/release.mjs 1.0.0",
    "gh release create v1.0.0",
    "gh workflow run release.yml -f tag=v1.0.0",
    "gh workflow run Release",
    "gh run rerun 123 --workflow release",
    "gh api repos/o/r/actions/runs/1/pending_deployments -f state=approved",
    "bash -c 'git tag v2.0.0 && git push --tags'",
    "npm run verify && git tag v1.2.3",
  ]) {
    assert.ok(bash(command), `should block: ${command}`);
  }
});

test("blocks direct pushes to main and guardrail edits", () => {
  for (const command of [
    "git push origin main",
    "git push origin HEAD:main",
    "git push -f origin main",
    "git push origin +main",
    "git push origin HEAD:refs/heads/main",
    "gh api -X PUT repos/o/r/branches/main/protection",
    "gh api --method DELETE repos/o/r/rulesets/1",
    "gh api -X PUT repos/o/r/environments/release",
    "gh api -X PUT repos/o/r/collaborators/bot",
    "gh secret set RAILWAY_TOKEN",
    "gh variable set CREWCUE_API_BASE_URL",
    "gh repo edit --enable-auto-merge",
    "gh auth login",
    "gh auth switch",
  ]) {
    assert.ok(bash(command), `should block: ${command}`);
  }
});

test("blocks Railway production and unscoped Railway writes", () => {
  for (const command of [
    "railway up --environment production",
    "railway up -e production --service CrewCue",
    "railway environment production",
    "railway up",
    "railway redeploy --service CrewCue",
    "railway run npm run db:migrate",
    "railway variables --set FOO=1",
  ]) {
    assert.ok(bash(command), `should block: ${command}`);
  }
});

test("allows everyday agent work", () => {
  for (const command of [
    "git tag",
    "git tag -l 'v*'",
    "git tag --list",
    "git tag --sort=-v:refname",
    "git push -u origin claude/launch-guardrails",
    "git push origin HEAD",
    "git push origin claude/main-menu-fix",
    "git commit -m 'tag v1 parsing'",
    "gh pr create --title x --body-file body.md",
    "gh pr merge 12 --squash --auto",
    "gh pr merge 12 --squash --delete-branch",
    "gh api repos/o/r/branches/main/protection",
    "gh run list --workflow release.yml",
    "npm run release -- 1.0.0 --dry-run",
    "npm run verify",
    "railway status",
    "railway logs --environment staging",
    "railway up --environment staging --service CrewCue",
    "railway variables --set FOO=1 --environment staging",
  ]) {
    assert.equal(bash(command), null, `should allow: ${command}`);
  }
});

test("Railway MCP: reads pass, production writes are blocked", () => {
  assert.equal(blockReason("mcp__railway__get-logs", { environmentId: PRODUCTION_ENVIRONMENT_ID }), null);
  assert.equal(blockReason("mcp__railway__list-services", {}), null);
  assert.equal(blockReason("mcp__railway__set-variables", { environmentId: STAGING, variables: { A: "1" } }), null);
  assert.ok(blockReason("mcp__railway__set-variables", { environmentId: PRODUCTION_ENVIRONMENT_ID }));
  assert.ok(blockReason("mcp__railway__redeploy", { serviceId: "s" }), "no environmentId defaults to production");
  assert.ok(blockReason("mcp__railway__accept-deploy", { environmentId: STAGING }));
  assert.ok(blockReason("mcp__railway__delete-service", { environmentId: STAGING }));
  assert.ok(blockReason("mcp__railway__railway-agent", { prompt: "redeploy production" }));
  assert.equal(blockReason("mcp__railway__railway-agent", { prompt: "why is staging slow" }), null);
});

test("other tools pass through", () => {
  assert.equal(blockReason("Edit", { file_path: "x" }), null);
  assert.equal(blockReason("Read", {}), null);
});

test("the hook exits 2 with a reason, 0 otherwise", () => {
  const run = (payload) =>
    spawnSync(process.execPath, [".claude/hooks/release-guard.mjs"], { input: JSON.stringify(payload), encoding: "utf8" });
  const blocked = run({ tool_name: "Bash", tool_input: { command: "git tag v9.9.9" } });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /release-guard:/);
  assert.equal(run({ tool_name: "Bash", tool_input: { command: "git status" } }).status, 0);
});
