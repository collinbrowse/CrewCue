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

- Last updated (local date/time): 2026-04-28 16:40 (UTC-6)
- Updated by (agent/human): Codex agent
- Branch: `main`
- Active issue: #177 (post-merge handoff refresh after PR #176)
- Active PR: #178 (handoff refresh for #177)
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
- Opened PR #174 for #173 with `Closes #173` in body and required Agent Handoff Continuity + Token Budget checklist sections completed.
- PR #174 merged to `main`; issue #173 auto-closed via linked issue workflow.
- Opened issue #175 and delivered a WS5 closure maintenance slice: explicit non-ping (`protocol`) safe-retry exclusion coverage in `outboxPolicy` tests and roadmap text alignment to pending ping-only behavior.
- Opened PR #176 for #175 with `Closes #175` in body; PR #176 merged to `main` (issue #175 closed).

---

## Current in-progress task

- Objective: Land PR #178 to close #177 and finalize post-merge handoff continuity after PR #176.
- Why it matters for MVP exit gates: Continuity docs must match merged reality so the next agent does not chase closed issues/PRs.
- Files currently touched: `docs/sdlc/agent-handoff.md`
- Dependencies/blockers:
  - Official external design-system source artifacts remain unavailable in-repo; fallback DS baseline is documented.

---

## Next 1-3 tasks (strict priority)

1. Task: Merge PR #178 to close #177 and refresh handoff snapshot to post-merge idle state.
   - Acceptance criteria: `Closes #177` in PR body + required continuity/token-budget checklist sections completed + checks green.
   - Evidence expected: https://github.com/collinbrowse/CrewCue/pull/178 merged + issue #177 closed.
2. Task: Run WS5 manual device/staging resilience check for pending/conflict/rejected recovery hints and capture operator evidence.
   - Acceptance criteria: Manual notes confirm distinct recovery guidance and expected CTA availability.
   - Evidence expected: Short manual validation bullets in handoff/PR test plan.
3. Task: Select and open the next single-slice Phase 2/3 closure issue mapped to an explicit roadmap/spec exit gate.
   - Acceptance criteria: Issue includes acceptance criteria + evidence mapping to `docs/sdlc/ui-delivery-roadmap-and-spec.md` / `docs/sdlc/mvp-ui-development-spec.md`.
   - Evidence expected: Issue URL/number in handoff.

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
  - GitHub merge evidence: PR #176 merged at `2026-04-28T22:15:34Z`; issue #175 closed.
  - Follow-up PR opened for continuity: https://github.com/collinbrowse/CrewCue/pull/178 (`Closes #177`).
  - `npm run lint` -> passed after adding explicit non-ping (`protocol`) safe-retry test coverage.
  - `npm run typecheck` -> passed.
  - `npm run build` -> passed (includes mobile `expo export` bundles).
  - `npm run test` -> passed (`@crewcue/mobile` + `@crewcue/api` + `@crewcue/contracts`, 0 failures).
  - `npm run verify` -> passed at repo root (dual-client guard, lint/typecheck/test/startup smoke/build parity chain).
  - `npm run verify` (post-merge sync to `main` at `64df3b7`) -> passed again after handoff refresh edits.
- Manual flow checks:
  - Confirmed roadmap phase text now matches implemented safe-retry scope (`pending` + `ping` only).
  - Confirmed no new API/outbox execution path was introduced; change is test/documentation guardrail only.
- Risks observed:
  - WS5 pending/conflict/rejected recovery UX still needs an updated live device/staging verification note (independent of the #175/#176 merge).

---

## Open risks, assumptions, and questions

- Risk: Handoff snapshot drift can recur after merges if post-merge refresh is not landed immediately.
- Assumption: Current roadmap phase remains Phase 2 until explicit Phase 2 exit-gap completion is merged.
- Question requiring human decision: Should next closure prioritize WS5 staging/device validation depth or Phase 3 WS3/WS4 acceptance hardening?

---

## Successor agent start prompt (copy/paste)

```text
Continue CrewCue from current handoff state and focus on issue #177.
Read in order:
1) docs/sdlc/agent-handoff.md
2) docs/sdlc/README.md
3) docs/sdlc/token-budget.md
4) docs/sdlc/mvp-ui-development-spec.md
5) docs/sdlc/ui-delivery-roadmap-and-spec.md
6) .cursor/rules/github-pr-issue-workflow.mdc
7) .github/pull_request_template.md

Before coding, restate phase/issue/PR, acceptance criteria, in-scope files, out-of-scope, validation plan, and guardrails (<=8 bullets).
Then monitor PR #178 to merge completion (checks + review), confirm issue #177 auto-closes, and refresh this handoff snapshot to a post-merge idle state (no stale active PR/issue lines).
```
