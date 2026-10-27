---
description: Issue/PR workflow for features and merges to main; required PR decision-guard sections (pr-decision-doc-guard)
---

# GitHub issues and pull requests

## Issues (optional by default)

**Create an issue** for multi-file features, cloud/staging work, agent waves, or when the user asks.

**Skip an issue** for drive-by fixes, docs/process tweaks, and one-off work when the user says to just ship it (this change qualifies).

## Delivery

1. Branch from **`main`**: `git checkout main && git pull`, then `git checkout -b feature/...` (or `chore/...`).
2. Implement, test, commit on that branch.
3. Open a **pull request** to `main`. **Do not push feature commits directly to `main`.**
4. **PR body:** copy and fill [`.github/pull_request_template.md`](../../.github/pull_request_template.md) into `gh pr create --body`. Generic Summary + Test plan recipes **fail** CI `pr-decision-doc-guard`.

Required sections (exact headers; filled same-line bullets):

- `## Decision Tree and Rationale` — `- Decision: …` (value may be `Single obvious path`)
- `## Implicit Assumptions and Invariants` — `- Assumption: …` (value may be `None identified`)
- `## Higher-Order Effects Check` — `- Summary: …` (value may be `None identified`)

Before claiming Done: `npm run agent:pr:done -- --body-file <path.md>` (or `-- <pr>` after open).

## Auto-close on merge

If an issue exists, the PR body **must** include `Closes #N` (or `Fixes` / `Resolves`) so [auto-close](../../.github/workflows/auto-close-linked-issues.yml) runs.

## Merge gate

1. CI green: `pr-decision-doc-guard`, `dual-client-guard`, and `checks` (lint, typecheck, build, tests).
2. Local parity before push: `npm run verify` at repo root when practical.
