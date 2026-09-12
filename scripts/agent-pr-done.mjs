#!/usr/bin/env node
/**
 * Machine Done gate for agent PRs.
 * Usage:
 *   npm run agent:pr:done -- 123
 *   npm run agent:pr:done -- --body-file path.md [--mobile]
 *   npm run agent:pr:done -- --body-file path.md --files apps/mobile/App.tsx
 * Exit 0 = Done checklist ok; 1 = incomplete. Stdout ≤15 lines.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assessPrDoneBody, pathsTouchMobile } from "./lib/agentReadyParse.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function printHelp() {
  process.stdout.write(`agent:pr:done — Done gate (≤15 lines)

Usage:
  npm run agent:pr:done -- <pr-number>
  npm run agent:pr:done -- --body-file <path.md> [--mobile]
  npm run agent:pr:done -- --body-file <path.md> --files path1 path2

Exit 0 if Done checklist ok; 1 otherwise.
`);
}

function parseArgs(argv) {
  const args = { pr: null, bodyFile: null, mobile: false, files: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--mobile") args.mobile = true;
    else if (a === "--body-file") args.bodyFile = argv[++i];
    else if (a.startsWith("--body-file=")) args.bodyFile = a.slice("--body-file=".length);
    else if (a === "--files") {
      while (argv[i + 1] && !argv[i + 1].startsWith("-")) {
        args.files.push(argv[++i]);
      }
    } else if (/^\d+$/.test(a)) args.pr = a;
  }
  return args;
}

function fetchPr(prNumber) {
  const meta = spawnSync(
    "gh",
    ["pr", "view", String(prNumber), "--json", "body,files"],
    { encoding: "utf8", cwd: repoRoot }
  );
  if (meta.status !== 0) {
    throw new Error(meta.stderr?.trim() || `gh pr view #${prNumber} failed`);
  }
  return JSON.parse(meta.stdout);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.pr && !args.bodyFile)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  let body;
  let mobileChanged = args.mobile;
  let label = "body-file";

  if (args.bodyFile) {
    const p = path.isAbsolute(args.bodyFile) ? args.bodyFile : path.join(repoRoot, args.bodyFile);
    body = fs.readFileSync(p, "utf8");
    label = path.basename(p);
    if (args.files.length) {
      mobileChanged = mobileChanged || pathsTouchMobile(args.files);
    }
  } else {
    const pr = fetchPr(args.pr);
    body = pr.body ?? "";
    label = `PR #${args.pr}`;
    const files = (pr.files ?? []).map((f) => f.path);
    mobileChanged = mobileChanged || pathsTouchMobile(files);
  }

  const result = assessPrDoneBody(body, { mobileChanged });
  const lines = [`agent:pr:done ${label}`, ...result.summary].slice(0, 15);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

main();
