#!/usr/bin/env node
/**
 * Validate PR decision-rationale sections (CI `pr-decision-doc-guard`).
 * Usage: node scripts/pr-decision-doc-guard.mjs --body-file path.md
 */
import fs from "node:fs";
import { assessPrDecisionDoc } from "./lib/prDecisionDocGuard.mjs";

function printHelp() {
  process.stdout.write(`pr-decision-doc-guard — required PR body sections

Usage:
  node scripts/pr-decision-doc-guard.mjs --body-file <path.md>

Exit 0 if Decision / Assumption / Summary sections pass; 1 otherwise.
`);
}

function parseBodyFile(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true, bodyFile: null };
    if (a === "--body-file") return { help: false, bodyFile: argv[++i] };
    if (a.startsWith("--body-file=")) return { help: false, bodyFile: a.slice("--body-file=".length) };
  }
  return { help: false, bodyFile: null };
}

function main() {
  const args = parseBodyFile(process.argv.slice(2));
  if (args.help || !args.bodyFile) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const body = fs.readFileSync(args.bodyFile, "utf8");
  const result = assessPrDecisionDoc(body);
  if (!result.ok) {
    for (const err of result.errors) {
      process.stdout.write(`${err}\n`);
    }
    process.exit(1);
  }
  process.stdout.write("PR decision documentation guard passed.\n");
}

main();
