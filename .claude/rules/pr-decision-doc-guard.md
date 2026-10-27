---
description: PR decision guard doc — required decision-rationale sections (CI pr-decision-doc-guard)
---

# PR decision guard doc

Every pull request body must be a **filled** `.github/pull_request_template.md`. Do **not** open or edit a PR with only `## Summary` + `## Test plan` — that skips this repo’s CI job `pr-decision-doc-guard`.

Copy the template into `gh pr create --body` / `gh pr edit --body`. Generic PR recipes do not apply here.

Required (exact headers; filled same-line bullets — instructional/comment text does not count):

- `## Decision Tree and Rationale` — `- Decision: …` (value may be `Single obvious path`)
- `## Implicit Assumptions and Invariants` — `- Assumption: …` (value may be `None identified`)
- `## Higher-Order Effects Check` — `- Summary: …` (value may be `None identified`)

Before open: `npm run agent:pr:done -- --body-file <path.md>`. After open: `npm run agent:pr:done -- <pr>`.
