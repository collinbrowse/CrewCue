# Agent handoff source of truth

Use this document as the mandatory continuity artifact between AI agents.

Every new agent session must read this file first, then the referenced SDLC docs.
Every finishing agent session must update this file before stopping.

---

## Required read order for every new agent

1. `docs/sdlc/agent-handoff.md` (this file)
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `docs/sdlc/mvp-ui-development-spec.md`
5. `docs/sdlc/ui-delivery-roadmap-and-spec.md`
6. `.cursor/rules/github-pr-issue-workflow.mdc`
7. `.github/pull_request_template.md`

Token budget guardrail:

- Keep this file <= 250 lines.
- Keep "Next 1-3 tasks" to max 3 items.
- Keep acceptance criteria lock to max 5 criteria.
- Move stale/completed narrative history to archive when this file grows too large.

---

## Session status snapshot (update first)

- Last updated (local date/time):
- Updated by (agent/human):
- Branch:
- Active issue:
- Active PR:
- Current roadmap phase:
- Current workstream(s):

---

## What is complete

- Completed item:
- Completed item:

---

## Current in-progress task

- Objective:
- Why it matters for MVP exit gates:
- Files currently touched:
- Dependencies/blockers:

---

## Next 1-3 tasks (strict priority)

1. Task:
   - Acceptance criteria:
   - Evidence expected:
2. Task:
   - Acceptance criteria:
   - Evidence expected:
3. Task:
   - Acceptance criteria:
   - Evidence expected:

---

## Acceptance criteria lock (must be explicit)

- Criterion:
  - Source doc section:
  - Verification method:
- Criterion:
  - Source doc section:
  - Verification method:

---

## Constraints and do-not-change guardrails

- Keep monorepo layering: contracts -> api -> client/sync -> UI -> docs.
- Do not duplicate API client or outbox execution paths.
- Server state remains authoritative; UI local state is derived/intent/ephemeral only.
- Do not start deferred WS6 work while phase 1-3 exit gates remain open.
- Do not merge without required issue linking and green checks.
- Additional task-specific constraints:

---

## Validation and evidence required before handoff/merge

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run verify`
- [ ] Staging/manual validation notes captured for touched flows
- [ ] Docs updated for workflow/operator-impacting changes

Validation notes:

- Command/output summary:
- Manual flow checks:
- Risks observed:

---

## Open risks, assumptions, and questions

- Risk:
- Assumption:
- Question requiring human decision:

---

## Successor agent start prompt (copy/paste)

```text
You are continuing CrewCue work. Read and follow in order:
1) docs/sdlc/agent-handoff.md (source of truth)
2) docs/sdlc/README.md
3) docs/sdlc/token-budget.md
4) docs/sdlc/mvp-ui-development-spec.md
5) docs/sdlc/ui-delivery-roadmap-and-spec.md
6) .cursor/rules/github-pr-issue-workflow.mdc
7) .github/pull_request_template.md

Before coding:
- Restate current phase, active issue, exact acceptance criteria, and validation plan.
- List files expected to change and why.
- Confirm what will not be changed.
- Keep pre-code restatement to <= 8 bullets.

Execution rules:
- Follow layering: contracts -> api -> client/sync -> UI -> docs.
- No duplicate API/outbox paths.
- Update docs if operator workflow changes.
- Keep PR merge-ready with linked issue and test evidence.
- Keep output concise and delta-focused.

At end:
- Update docs/sdlc/agent-handoff.md with completed work, remaining tasks, risks, and an updated successor prompt.
- Keep end summary <= 10 bullets and successor prompt <= 25 lines.
```
