/**
 * Shared Ready/Done parsers for agent harness scripts.
 * Keep stdout consumers short — callers print ≤15 lines.
 */

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

/**
 * @param {string} body
 * @param {{ mobileChanged?: boolean }} [opts]
 * @returns {{ ok: boolean, missing: string[], summary: string[] }}
 */
export function assessPrDoneBody(body, opts = {}) {
  const text = (body ?? "").replace(/\uFEFF/g, "").replace(/\u00A0/g, " ");
  const missing = [];
  const summary = [];

  if (!/\b(Closes|Fixes|Resolves)\s+#\d+/i.test(text)) {
    missing.push("Closes #<n>");
  }

  const hasEdgeProof =
    /edge[- ]case/i.test(text) ||
    /\bEC\d+\b/.test(text) ||
    /\bProof\b/i.test(text);
  if (!hasEdgeProof) {
    missing.push("edge-case proof section");
  }

  if (opts.mobileChanged) {
    const hasSimNote =
      /agent:ios:ready/i.test(text) ||
      /simulator/i.test(text) ||
      /snapshot_ui/i.test(text) ||
      /\bBlocker\b/i.test(text);
    if (!hasSimNote) {
      missing.push("mobile sim evidence / blocker note");
    }
  }

  const ok = missing.length === 0;
  summary.push(ok ? "PASS: Done checklist" : "FAIL: Done incomplete");
  if (missing.length) {
    summary.push(`missing: ${missing.join(", ")}`);
  }
  if (opts.mobileChanged) {
    summary.push("mobile paths changed: sim evidence required");
  }
  return { ok, missing, summary };
}

/**
 * @param {string[]} files
 * @returns {boolean}
 */
export function pathsTouchMobile(files) {
  return files.some((f) => f.startsWith("apps/mobile/") || f.includes("/apps/mobile/"));
}
