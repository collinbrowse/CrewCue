#!/usr/bin/env node
/**
 * stop hook: one follow-up line max. Does not force loops.
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
const status = String(input.status ?? input.completion_status ?? "");
/** @type {{ followup_message?: string }} */
const out = {};

if (/error|failed|incomplete/i.test(status)) {
  out.followup_message =
    "Before stop: note blocker ≤10 bullets; for agent-ready issues run agent:issue:ready / agent:pr:done.";
}

process.stdout.write(`${JSON.stringify(out)}\n`);
