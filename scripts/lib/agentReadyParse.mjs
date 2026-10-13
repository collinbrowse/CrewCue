/**
 * Shared Ready/Done parsers for agent harness scripts.
 * Keep stdout consumers short — callers print ≤15 lines.
 */
import { assessPrDecisionDoc } from "./prDecisionDocGuard.mjs";

/** @typedef {{ ok: boolean, missing: string[], warnings: string[], summary: string[] }} ReadyResult */

const READY_SECTIONS = [
  { id: "objective", patterns: [/^#{1,3}\s*objective\b/im] },
  {
    id: "in-scope",
    patterns: [/^#{1,3}\s*in[- ]scope\b/im, /^#{1,3}\s*scope\b/im, /^#{1,3}\s*in-scope changes\b/im]
  },
  { id: "out-of-scope", patterns: [/^#{1,3}\s*out of scope\b/im] },
  { id: "acceptance", patterns: [/^#{1,3}\s*acceptance criteria\b/im] },
  { id: "edge-case-matrix", patterns: [/^#{1,3}\s*edge[- ]case matrix\b/im] },
  { id: "fixtures", patterns: [/^#{1,3}\s*fixtures\b/im] },
  { id: "depends", patterns: [/^#{1,3}\s*depends on\b/im] },
  {
    id: "verification",
    patterns: [/^#{1,3}\s*verification(?:\s+commands)?\b/im]
  },
  {
    id: "conflicts",
    patterns: [/^#{1,3}\s*(?:path )?conflict(?:s)?(?:\s+with|\s+map)?\b/im]
  }
];

/**
 * @param {string} body
 * @returns {ReadyResult}
 */
export function assessReadyBody(body) {
  const text = (body ?? "").replace(/\uFEFF/g, "").replace(/\u00A0/g, " ").trim();
  const missing = [];
  const warnings = [];
  const summary = [];

  if (!text) {
    return {
      ok: false,
      missing: ["body"],
      warnings: [],
      summary: ["FAIL: empty issue body"]
    };
  }

  for (const section of READY_SECTIONS) {
    const found = section.patterns.some((re) => re.test(text));
    if (!found) {
      missing.push(section.id);
    }
  }

  const emptyProofs = countEmptyProofCells(text);
  if (emptyProofs > 0) {
    warnings.push(`${emptyProofs} edge-case Proof cell(s) empty`);
  }

  const ok = missing.length === 0 && emptyProofs === 0;
  summary.push(ok ? "PASS: Ready fields present" : "FAIL: not Ready");
  if (missing.length) {
    summary.push(`missing: ${missing.join(", ")}`);
  }
  for (const w of warnings) {
    summary.push(`warn: ${w}`);
  }
  return { ok, missing, warnings, summary };
}

/**
 * @param {string} body
 * @returns {number}
 */
export function countEmptyProofCells(body) {
  const lines = body.split("\n");
  let empty = 0;
  let inTable = false;
  for (const line of lines) {
    if (/edge[- ]case matrix/i.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable && /^#{1,3}\s+\S/.test(line)) {
      break;
    }
    if (!inTable || !line.trim().startsWith("|")) continue;
    if (/^\|\s*-+/.test(line) || /\bProof\b/i.test(line)) continue;
    const parts = line.split("|").map((c) => c.trim());
    // Drop leading/trailing empties from markdown "| a | b |" rows.
    const cells = parts.slice(1, parts.length - 1);
    if (cells.length < 4) continue;
    const proof = cells[cells.length - 1] ?? "";
    if (!proof || proof === "-" || proof === "—") {
      empty += 1;
    }
  }
  return empty;
}

const EVIDENCE_COMMANDS = {
  ios: /agent:ios:ready|test:ios/,
  android: /agent:android:ready|test:android/
};

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

/** A ticked `- [x]` line naming the platform's proof command, or a filled `Blocker:` line. */
export function hasDeviceEvidence(body, platform) {
  const lines = stripComments(body).split("\n");
  const checked = lines.some((line) => /^\s*[-*]\s+\[[xX]\]/.test(line) && EVIDENCE_COMMANDS[platform].test(line));
  const blocker = lines.some((line) => {
    const match = /^[ \t]*[-*]?[ \t]*\**Blocker\**[ \t]*[:\u2014-][ \t]*(.+)$/i.exec(line);
    if (!match) return false;
    const value = match[1].trim();
    const placeholder = /^_.*_$/.test(value) || /^none\b/i.test(value);
    return !placeholder && value.replace(/[_*`]/g, "").length >= 10;
  });
  return checked || blocker;
}

/**
 * @param {string} body
 * @param {{ iosChanged?: boolean, androidChanged?: boolean, splitViolation?: boolean }} [opts]
 * @returns {{ ok: boolean, missing: string[], summary: string[] }}
 */
export function assessPrDoneBody(body, opts = {}) {
  const text = stripComments((body ?? "").replace(/\uFEFF/g, "").replace(/\u00A0/g, " "));
  const missing = [];
  const summary = [];

  if (!/\b(Closes|Fixes|Resolves)\s+#\d+/i.test(text) && !/^[ \t]*[-*]?[ \t]*No issue:[ \t]*\S/im.test(text)) {
    missing.push("Closes #<n> (or `No issue: <reason>`)");
  }

  if (!/^[ \t]*[-*]?[ \t]*\**EC\d+\**[ \t]*[:\u2014-][ \t]*\S/m.test(text)) {
    missing.push("edge-case proof (`EC1: <how it was proven>`)");
  }

  const decision = assessPrDecisionDoc(text);
  if (!decision.ok) {
    missing.push("pr-decision-doc-guard sections");
  }

  if (opts.iosChanged && !hasDeviceEvidence(text, "ios")) missing.push("ios evidence (checked test:ios / agent:ios:ready, or Blocker:)");
  if (opts.androidChanged && !hasDeviceEvidence(text, "android"))
    missing.push("android evidence (checked test:android / agent:android:ready, or Blocker:)");
  if (opts.splitViolation) missing.push("one platform per PR");

  const ok = missing.length === 0;
  summary.push(ok ? "PASS: Done checklist" : "FAIL: Done incomplete");
  if (missing.length) {
    summary.push(`missing: ${missing.join(", ")}`);
  }
  if (!decision.ok) {
    summary.push(...decision.errors);
  }
  if (opts.iosChanged) summary.push("ios paths changed: simulator evidence required");
  if (opts.androidChanged) summary.push("android paths changed: emulator evidence required");
  if (opts.splitViolation) summary.push("split: both native UI trees changed");
  return { ok, missing, summary };
}
