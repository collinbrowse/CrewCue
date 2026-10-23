/**
 * Shared PR decision-doc guard (CI job `pr-decision-doc-guard` + agent:pr:done).
 * Keep in sync with the required sections in `.github/pull_request_template.md`.
 */

export const PR_DECISION_REQUIRED_HEADERS = [
  "## Decision Tree and Rationale",
  "## Implicit Assumptions and Invariants",
  "## Higher-Order Effects Check"
];

/**
 * @param {string | null | undefined} body
 * @returns {string}
 */
export function normalizePrDecisionBody(body) {
  return String(body ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\u2011|\u2013|\u2014/g, "-");
}

/** @param {string} word */
function mdLabel(word) {
  // List item must start the line; content on the same line (see pull_request_template.md).
  return new RegExp(`^-\\s*\\*{0,2}${word}:\\*{0,2}[ \\t]+\\S`, "im");
}

/**
 * @param {string | null | undefined} body
 * @returns {{ ok: boolean, missing: string[], errors: string[] }}
 */
export function assessPrDecisionDoc(body) {
  const text = normalizePrDecisionBody(body);
  const missing = [];
  const errors = [];

  const missingHeaders = PR_DECISION_REQUIRED_HEADERS.filter((header) => !text.includes(header));
  if (missingHeaders.length) {
    missing.push(...missingHeaders);
    errors.push(`PR body missing required section headers: ${missingHeaders.join(", ")}`);
  }

  if (!mdLabel("Decision").test(text)) {
    missing.push("- Decision:");
    errors.push(
      "Decision Tree and Rationale must include at least one filled '- Decision: ...' (or **Decision**) line. Value may be 'Single obvious path'."
    );
  }

  if (!mdLabel("Assumption").test(text)) {
    missing.push("- Assumption:");
    errors.push(
      "Implicit Assumptions and Invariants must include at least one filled '- Assumption: ...' (or **Assumption**) line. Value may be 'None identified'."
    );
  }

  if (!mdLabel("Summary").test(text)) {
    missing.push("- Summary:");
    errors.push(
      "Higher-Order Effects Check must include a filled '- Summary: ...' (or **Summary**) line. Value may be 'None identified'."
    );
  }

  return { ok: missing.length === 0, missing, errors };
}
