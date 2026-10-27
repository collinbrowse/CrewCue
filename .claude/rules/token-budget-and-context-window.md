---
description: Keep agent context small; skip ceremony on trivial tasks
---

# Token budget (always on, short)

- Prefer targeted file reads over broad doc scans.
- **Fast path (default):** implement → scoped `verify:*` mid-slice → full `npm run verify` pre-PR. No mandatory doc pack, scope restatement, issue, or handoff update.
- **PRs:** filled `.github/pull_request_template.md` in `--body` (not Summary-only). `agent:pr:done` enforces `pr-decision-doc-guard`.
- **agent-ready / waves:** `npm run agent:issue:ready -- <n>` then issue body; script stdout replaces Ready-doc re-reads.
- **Non-trivial / multi-session:** read `docs/sdlc/agent-handoff.md` only if continuity matters; feature agents use PR **Handoff delta**, not handoff edits.
- Keep replies concise: status, evidence, next 1–3 steps.
- Do not paste large docs into the chat when paths already exist in-repo.
