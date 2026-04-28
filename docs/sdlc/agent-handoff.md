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

- Last updated (local date/time): 2026-04-28 17:05 (UTC-6)
- Updated by (agent/human): Codex agent
- Branch: `docs/handoff-post-pr178-ws5-179` (PR targets `main`, closes #180)
- Active issue: #179 (WS5 field validation — primary); #180 (handoff doc PR — closes when PR merges)
- Active PR: (filled when PR opened for this branch)
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
- Opened issue #177 and landed PR #178 (`Closes #177`): post–PR #176 handoff continuity; PR #178 merged `2026-04-28T22:22:34Z`, issue #177 closed `2026-04-28T22:22:35Z`.
- Opened issue #180 to track the post–PR #178 handoff snapshot PR (`Closes #180`); opened issue #179 for WS5 staging/device exit-gate validation (stays open until operator evidence lands).

---

## Current in-progress task

- Objective: Close Phase 2 WS5 **exit gate evidence** for operator-distinguishable pending vs conflict vs rejected recovery (`ui-delivery-roadmap-and-spec.md` Phase 2 exit gate) via issue #179.
- Why it matters for MVP exit gates: Field validation is the remaining gap before treating WS5 resilience UI as exit-ready versus code-complete.
- Files / surfaces: `Operate → Outbox Detail` (`OperateOutboxScreen` / `OutboxQueueInspector`), `outboxPolicy` safe-retry eligibility, staging or device + real room.
- Dependencies/blockers:
  - Official external design-system source artifacts remain unavailable in-repo; fallback DS baseline is documented.
  - Live staging/device time is human-operated; this issue tracks evidence, not implementation, unless mismatches are found.

---

## Next 1-3 tasks (strict priority)

1. Task: Execute issue #179 on staging/device; paste operator bullets into handoff validation (or linked PR) and close #179 with evidence PR if needed.
   - Acceptance criteria: Per issue #179 (pending / conflict / rejected observations + safe-retry CTA parity).
   - Evidence expected: Dated notes + build/staging identifier in handoff or PR test plan.
2. Task: If #179 finds UX/copy gaps, open a single-slice implementation issue + PR (no new outbox execution paths).
   - Acceptance criteria: Issue links roadmap exit gate; PR includes tests for any policy/UI change.
   - Evidence expected: Green `npm run verify` + handoff delta.
3. Task: When WS5 exit gate is satisfied, pick one Phase 3 WS3 or WS4 roadmap slice and open a scoped issue before coding.
   - Acceptance criteria: Issue states exit gate from `mvp-ui-development-spec.md` / `ui-delivery-roadmap-and-spec.md`.
   - Evidence expected: Issue number in handoff successor prompt.

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
  - PR #178 merged at `2026-04-28T22:22:34Z` (`b5c2cd9` on `main`); issue #177 closed at `2026-04-28T22:22:35Z`.
  - Tracking issue for live WS5 checks: https://github.com/collinbrowse/CrewCue/issues/179
  - `npm run lint` -> passed after adding explicit non-ping (`protocol`) safe-retry test coverage.
  - `npm run typecheck` -> passed.
  - `npm run build` -> passed (includes mobile `expo export` bundles).
  - `npm run test` -> passed (`@crewcue/mobile` + `@crewcue/api` + `@crewcue/contracts`, 0 failures).
  - `npm run verify` -> passed at repo root (dual-client guard, lint/typecheck/test/startup smoke/build parity chain).
  - `npm run verify` (post-merge sync to `main` at `64df3b7`) -> passed again after handoff refresh edits.
  - `npm run verify` on this branch after handoff edits -> **passed** (exit 0; dual-client guard, lint, typecheck, tests, mobile `expo export`, API/contracts build).
- Manual flow checks:
  - Confirmed roadmap phase text now matches implemented safe-retry scope (`pending` + `ping` only).
  - Confirmed no new API/outbox execution path was introduced; change is test/documentation guardrail only.
  - **WS5 operator checklist (code-backed, for #179):** In Outbox Detail, expect conflict hint: refresh room/projection, confirm latest state, retry Process Outbox, optional merge telemetry when role allows. Rejected hint: update inputs, enqueue again. Pending with `attempts > 0`: connectivity / foreground auto-process. Safe retry copy + button only when entry is **pending** and type **ping** (`isSafeOutboxRetryCandidate`); not for conflict/rejected ping or non-ping pending.
- Risks observed:
  - Live staging/device confirmation for #179 is still outstanding until an operator runs the checklist.

---

## Open risks, assumptions, and questions

- Risk: Handoff snapshot drift can recur after merges if post-merge refresh is not landed immediately.
- Assumption: Current roadmap phase remains Phase 2 until WS5 exit gate evidence (#179) and any follow-up fixes land.
- Decision (2026-04-28): Next prioritized closure is **WS5 field validation** tracked by #179; Phase 3 WS3/WS4 hardening follows after the Phase 2 exit gate is satisfied or explicitly reprioritized by product.

---

## Successor agent start prompt (copy/paste)

```text
Continue CrewCue from current handoff state and focus on issue #179 (WS5 staging/device validation).
Read in order:
1) docs/sdlc/agent-handoff.md
2) docs/sdlc/README.md
3) docs/sdlc/token-budget.md
4) docs/sdlc/mvp-ui-development-spec.md
5) docs/sdlc/ui-delivery-roadmap-and-spec.md
6) .cursor/rules/github-pr-issue-workflow.mdc
7) .github/pull_request_template.md

Before coding, restate phase/issue/PR, acceptance criteria, in-scope files, out-of-scope, validation plan, and guardrails (<=8 bullets).
Run the #179 checklist on staging/device (Operate → Outbox Detail). Record dated operator bullets in this handoff or in the PR that closes #179. If behavior diverges from `OutboxQueueInspector` / `outboxPolicy`, open a fix issue instead of silent drift.
```
