#!/usr/bin/env node
/**
 * PreToolUse hook: agents may merge to main, but only a human ships to users.
 *
 * Blocks release tags, the release workflow, deployment approvals, GitHub
 * guardrail edits, and any write to the Railway production environment.
 * Exit 2 tells Claude Code to refuse the call and show the reason to the agent.
 *
 * This is the first layer. The second is GitHub itself: agents push as a
 * Write-role bot that cannot create v* tags or approve the `release`
 * environment (docs/runbooks/launch-owner-setup.md).
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PRODUCTION_ENVIRONMENT_ID = "7d69819c-2f55-4f58-811b-e075b6a77043";

const HUMAN_ONLY = "Releases and production are human-only. Stop here and ask the user to run it (docs/runbooks/launch-owner-setup.md).";

/** Shell patterns. Each is checked against the whole command, so `bash -c "..."` and `&&` chains are caught too. */
const SHELL_RULES = [
  // `git tag`, `git tag -l`, `git tag --list v*` and `git tag --sort=...` list; anything else creates or deletes.
  [/\bgit\s+(?:-C\s+\S+\s+)?tag\s+(?!-l\b|--list\b|--contains\b|--no-contains\b|--points-at\b|--merged\b|--sort\b|-n\d*\b)\S/, "Creating or deleting git tags"],
  [/\bgit\s+(?:-C\s+\S+\s+)?push\b[^;&|\n]*(?:--tags|--follow-tags|--mirror|refs\/tags\/|\s:?v\d+\.\d+)/, "Pushing tags"],
  [/\bgit\s+(?:-C\s+\S+\s+)?push\b[^;&|\n]*(?:\s|:|\+)(?:refs\/heads\/)?main(?=\s|$|[;&|"'])/, "Pushing straight to main (open a PR and merge it instead)"],
  [/\bnpm\s+run\s+release\b(?![^;&|\n]*--dry-run)/, "npm run release"],
  [/\bnode\s+\S*scripts\/release\.mjs\b(?![^;&|\n]*--dry-run)/, "scripts/release.mjs"],
  [/\bgh\s+release\s+(?:create|edit|upload|delete)\b/, "gh release writes"],
  [/\bgh\s+workflow\s+(?:run|enable|disable)\s+["']?release/i, "Running the Release workflow"],
  [/\bgh\s+run\s+(?:rerun|cancel)\b[^;&|\n]*release/i, "Re-running the Release workflow"],
  [/pending_deployments|deployment_protection_rules/, "Approving or editing deployment gates"],
  [/\bgh\s+api\b(?=[^;&|\n]*(?:-X|--method)\s*(?:POST|PUT|PATCH|DELETE))(?=[^;&|\n]*(?:\/rulesets|\/protection|\/environments|\/collaborators|\/actions\/secrets|\/actions\/variables|\/keys\b|\/hooks\b))/i, "Changing repo rulesets, protection, environments, secrets or access"],
  [/\bgh\s+(?:secret|variable)\s+(?:set|delete|remove)\b/, "Changing GitHub secrets or variables"],
  [/\bgh\s+repo\s+(?:edit|delete|archive|rename)\b/, "Changing repo settings"],
  [/\bgh\s+auth\s+(?:login|switch|token|refresh)\b/, "Switching GitHub identity"],
  [/\brailway\b[^;&|\n]*(?:(?:-e|--environment)[\s=]+["']?production\b|environment\s+(?:link\s+)?production\b)/, "Railway commands against production"],
  [/\brailway\s+(?:up|redeploy|down|delete|run|shell|connect|variables\s+--set|domain|volume)\b(?![^;&|\n]*(?:-e|--environment)[\s=]+["']?staging)/, "Railway writes without an explicit staging environment"],
];

const RAILWAY_READ_ONLY = /^mcp__railway__(?:list-|describe-|get-|search-|fetch-docs|whoami|environment-status|domain-status|http-)/;
const RAILWAY_ALWAYS_BLOCKED = /^mcp__railway__(?:accept-deploy|delete-|deploy-template|create-project|reset-bucket-credentials)/;

/** Returns why the call is blocked, or null when it may run. */
export function blockReason(toolName, toolInput = {}) {
  if (toolName === "Bash") {
    const command = String(toolInput.command ?? "");
    for (const [pattern, label] of SHELL_RULES) {
      if (pattern.test(command)) return `${label} is blocked for agents. ${HUMAN_ONLY}`;
    }
    return null;
  }

  if (toolName.startsWith("mcp__railway__")) {
    if (RAILWAY_READ_ONLY.test(toolName)) return null;
    if (RAILWAY_ALWAYS_BLOCKED.test(toolName)) return `${toolName} is blocked for agents. ${HUMAN_ONLY}`;
    const text = JSON.stringify(toolInput);
    if (text.includes(PRODUCTION_ENVIRONMENT_ID) || /"environment(?:Name|Id)?"\s*:\s*"production"/i.test(text)) {
      return `Railway writes to production are blocked for agents. ${HUMAN_ONLY}`;
    }
    if (toolName === "mcp__railway__railway-agent" && /\bprod(?:uction)?\b/i.test(text)) {
      return `The Railway agent may not act on production. ${HUMAN_ONLY}`;
    }
    if (!/"environmentId"\s*:/.test(text) && toolName !== "mcp__railway__railway-agent") {
      return `${toolName} needs an explicit staging environmentId; without one Railway defaults to production. ${HUMAN_ONLY}`;
    }
    return null;
  }

  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0);
  }
  const reason = blockReason(payload.tool_name ?? "", payload.tool_input ?? {});
  if (reason) {
    process.stderr.write(`release-guard: ${reason}\n`);
    process.exit(2);
  }
}
