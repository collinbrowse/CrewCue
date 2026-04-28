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

- Last updated (local date/time): 2026-04-28 16:00 (UTC-6)
- Updated by (agent/human): Codex agent
- Branch: `main` (assumed from workspace snapshot; verify before PR prep)
- Active issue: #173 (WS5 safe retry restricted to pending ping)
- Active PR: none (PR #172 merged)
- Current roadmap phase: Phase 2 (WS5 resilience UI), with Phase 1 shell/structure in place
- Current workstream(s): WS1, WS2, WS3, WS4, WS5

---

## What is complete

- Canonical SDLC continuity files are aligned and present (`README`, token budget, roadmap/spec, PR template, handoff rules).
- Phase 1/2 mobile UI hardening/design-system fallback documentation updates are already captured in roadmap/spec revision history.
- This handoff file has now been converted from placeholder template to an actionable current-state artifact.
- Opened issue #171 and delivered a WS5 consistency slice: safe-retry messaging now matches the actual supported outbox retry type (`ping`) and is backed by sync-layer eligibility tests.
- PR #172 merged to `main` with linked closure for #171.
- Opened issue #173 and delivered a WS5 behavior-hardening slice: safe retry eligibility now requires `pending` + `ping` (conflict/rejected ping entries no longer qualify), aligning action availability with recovery semantics.

---

## Current in-progress task

- Objective: Prepare merge-ready PR for completed issue #173 and then select the next smallest Phase 2/3 closure slice.
- Why it matters for MVP exit gates: Converts validated WS5 hardening into merged baseline, then continues closure sequencing.
- Files currently touched: `apps/mobile/src/sync/outboxPolicy.ts`, `apps/mobile/src/sync/outboxPolicy.test.ts`, `docs/sdlc/agent-handoff.md`
- Dependencies/blockers:
  - Official external design-system source artifacts remain unavailable in-repo; fallback DS baseline is documented.

---

## Next 1-3 tasks (strict priority)

1. Task: Open merge-ready PR for issue #173.
   - Acceptance criteria: PR includes `Closes #173`, continuity checklist complete, token-budget check complete.
   - Evidence expected: PR URL + checklist completion status in handoff.
2. Task: Select and open the next single-slice Phase 2/3 closure issue after #173.
   - Acceptance criteria: New issue scoped to one unresolved gate and mapped to roadmap/spec criteria.
   - Evidence expected: Issue URL/number and short acceptance-criteria mapping in handoff.
3. Task: Implement that next issue as one smallest complete slice with repo-level validation.
   - Acceptance criteria: `npm run verify` passes and no duplicate API/outbox paths are introduced.
   - Evidence expected: Validation summary + diff scope in handoff.

---

## Acceptance criteria lock (must be explicit)

- Criterion: Handoff snapshot fields are complete and current.
  - Source doc section: `.cursor/rules/agent-handoff-continuity.mdc` start/end requirements.
  - Verification method: Manual inspection of `Session status snapshot`.
- Criterion: Handoff includes completed work, next 1-3 tasks, validation evidence summary, risks/blockers/questions, and successor prompt.
  - Source doc section: `.cursor/rules/agent-handoff-continuity.mdc` end-of-task requirements.
  - Verification method: Manual section-by-section checklist.
- Criterion: Token-budget limits are respected (concise, delta-only, max 3 next tasks, max 5 acceptance criteria).
  - Source doc section: `docs/sdlc/token-budget.md` hard budgets.
  - Verification method: `wc -l` and manual count checks.
- Criterion: Guardrails preserve layering and anti-duplication constraints.
  - Source doc section: `docs/sdlc/ui-delivery-roadmap-and-spec.md` sections 4, 7, 8.
  - Verification method: Manual guardrail review before and after edits.

---

## Constraints and do-not-change guardrails

- Keep monorepo layering: contracts -> api -> client/sync -> UI -> docs.
- Do not duplicate API client or outbox execution paths.
- Server state remains authoritative; UI local state is derived/intent/ephemeral only.
- Do not start deferred WS6 work while phase 1-3 exit gates remain open.
- Do not merge without required issue linking and green checks.
- Task-specific: maintain WS5 behavior parity; do not add new outbox execution paths.

---

## Validation and evidence required before handoff/merge

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test`
- [x] `npm run verify`
- [x] Staging/manual validation notes captured for touched flows
- [x] Docs updated for workflow/operator-impacting changes

Validation notes:

- Command/output summary:
  - `npm run test --workspace @crewcue/mobile` -> passed (35 tests, 0 failed), including updated `outboxPolicy` eligibility coverage.
  - `npm run verify` -> passed at repo root (lint, typecheck, tests, mobile bundle export, workspace builds).
- Manual flow checks:
  - Confirmed safe retry eligibility now excludes `conflict`/`rejected` ping operations (`pending`+`ping` only), removing contradictory recovery CTA states.
  - Verified safe-retry helper now aligns with UI copy (ping-only).
  - Verified no duplicate API/outbox path was introduced (shared helper in `outboxPolicy` consumed by UI).
- Risks observed:
  - WS5 behavior change is unit/integration-validated but not yet manually verified on a live device/staging session in this slice.

---

## Open risks, assumptions, and questions

- Risk: PR for #173 is not yet opened, so validated code is not yet in merge-review flow.
- Assumption: Current roadmap phase remains Phase 2 until a Phase 2 exit-gap item is explicitly closed and merged.
- Question requiring human decision: After #173 PR prep, should next scope prioritize WS5 manual-device validation depth or WS3/WS4 acceptance-gate hardening?

---

## Successor agent start prompt (copy/paste)

```text
Continue CrewCue from current handoff state.
Read in order:
1) docs/sdlc/agent-handoff.md
2) docs/sdlc/README.md
3) docs/sdlc/token-budget.md
4) docs/sdlc/mvp-ui-development-spec.md
5) docs/sdlc/ui-delivery-roadmap-and-spec.md
6) .cursor/rules/github-pr-issue-workflow.mdc
7) .github/pull_request_template.md

Before coding, restate phase/issue/PR, acceptance criteria, in-scope files, out-of-scope, validation plan, and guardrails (<=8 bullets).
Then open a merge-ready PR for issue #173 (include `Closes #173` and complete continuity/token-budget checklist sections), verify checks, and update this handoff with PR evidence and next scoped issue selection.
```
