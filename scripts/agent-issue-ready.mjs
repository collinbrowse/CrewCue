#!/usr/bin/env node
/**
 * Machine Ready gate for agent-ready issues.
 * Usage:
 *   npm run agent:issue:ready -- 490
 *   npm run agent:issue:ready -- --body-file path.md
 * Exit 0 = Ready; 1 = not Ready. Stdout ≤15 lines.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assessReadyBody } from "./lib/agentReadyParse.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function printHelp() {
  process.stdout.write(`agent:issue:ready — Ready gate (≤15 lines)

Usage:
  npm run agent:issue:ready -- <issue-number>
  npm run agent:issue:ready -- --body-file <path.md>

Exit 0 if Ready; 1 otherwise. Prefer this over re-reading async-delivery Ready prose.
`);
}

function parseArgs(argv) {
  const args = { issue: null, bodyFile: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--body-file") args.bodyFile = argv[++i];
    else if (/^\d+$/.test(a)) args.issue = a;
    else if (a.startsWith("--body-file=")) args.bodyFile = a.slice("--body-file=".length);
  }
  return args;
}

function fetchIssueBody(issueNumber) {
  const r = spawnSync(
    "gh",
    ["issue", "view", String(issueNumber), "--json", "body,title,labels"],
    { encoding: "utf8", cwd: repoRoot }
  );
  if (r.status !== 0) {
    throw new Error(r.stderr?.trim() || `gh issue view #${issueNumber} failed`);
  }
  return JSON.parse(r.stdout);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.issue && !args.bodyFile)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  let body;
  let label = "body-file";
  if (args.bodyFile) {
    const p = path.isAbsolute(args.bodyFile) ? args.bodyFile : path.join(repoRoot, args.bodyFile);
    body = fs.readFileSync(p, "utf8");
    label = path.basename(p);
  } else {
    const issue = fetchIssueBody(args.issue);
    body = issue.body ?? "";
    label = `#${args.issue}`;
    const labels = (issue.labels ?? []).map((l) => l.name);
    if (!labels.includes("agent-ready")) {
      process.stdout.write(`warn: ${label} missing label agent-ready\n`);
    }
  }

  const result = assessReadyBody(body);
  const lines = [`agent:issue:ready ${label}`, ...result.summary].slice(0, 15);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

main();
