#!/usr/bin/env node
/**
 * One-line shell reminders (token-cheap). Never blocks.
 * stdin: Cursor beforeShellExecution JSON.
 */
import { readFileSync } from "node:fs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "{}";
  }
}

const input = JSON.parse(readStdin() || "{}");
const command = String(input.command ?? "");
/** @type {{ permission: string, agent_message?: string }} */
const out = { permission: "allow" };

if (/\bgit\s+commit\b/.test(command) && !/#\d+/.test(command)) {
  out.agent_message =
    "Reminder: prefer commits/PRs that reference an issue (#N). Run agent:pr:done before claiming Done.";
} else if (/\bagent:ios:ready\b/.test(command)) {
  out.agent_message =
    "After ready: prefer Auth0-free crewcue://dev/schedule-sheet|cold-start|pace-estimate for proof.";
} else if (/\bagent:issue:ready\b/.test(command)) {
  out.agent_message = "Ready gate stdout replaces re-reading async-delivery Ready prose.";
} else if (/\bnpm run verify\b/.test(command) && !/verify:(api|mobile|contracts)/.test(command)) {
  out.agent_message =
    "Token tip: mid-slice prefer verify:api|mobile|contracts; full verify at pre-PR.";
}

process.stdout.write(`${JSON.stringify(out)}\n`);
