#!/usr/bin/env node
/**
 * Fail a change list that edits both native UI trees.
 * Checklist-only diffs under clients/behavior are allowed.
 * Usage: node scripts/verify-client-pr-split.mjs --files path ...
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyNativeClientDiff } from "./lib/clientSplit.mjs";

const args = process.argv.slice(2);
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--files") {
    while (args[i + 1] && !args[i + 1].startsWith("-")) files.push(args[++i]);
  }
}

if (files.length === 0) {
  console.log("verify:client-pr-split passed (no file list)");
  process.exit(0);
}

const result = classifyNativeClientDiff(files.map((file) => file.split(path.sep).join("/")));
if (result.splitViolation) {
  console.error("verify:client-pr-split failed: a PR may not change apps/ios and apps/android together");
  process.exit(1);
}
console.log("verify:client-pr-split passed");
