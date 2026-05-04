## Workstream

- WS1
- WS2
- WS3
- WS4
- WS5
- WS6
- WS7

## Linked issues (required for auto-close on merge)

Every task should have a GitHub issue **before** implementation. When this PR merges, the following line(s) **close** those issues (workflow: `.github/workflows/auto-close-linked-issues.yml`). Use one keyword per line: `Closes`, `Fixes`, or `Resolves`.

Closes #


## Scope

Describe exactly what this PR changes.

## Decision Tree and Rationale (required)

Document the key decisions that shaped this implementation so future debugging can reconstruct intent.

<!-- CI (`.github/workflows/ci.yml` `pr-decision-doc-guard`) requires a literal line matching `- Decision: <text>` (same line), or the phrase "Single obvious path". Do not use bold (e.g. `- **Decision:**`) — the check will fail. Same pattern for `- Assumption:` and `- Summary:` in the sections below. -->

- Decision:
  - Context:
  - Alternatives considered:
  - Why selected:

<!-- Repeat for each major decision. If only one straightforward path existed, explicitly state: "Single obvious path; no meaningful alternatives." -->

## Implicit Assumptions and Invariants (required)

List assumptions that are not obvious from code alone.

- Assumption:
  - Why it is safe today:
  - What would break if false:

## Higher-Order Effects Check (required)

Explicitly note downstream effects. If none, write "None identified."

- [ ] Second-order effects reviewed (adjacent modules, retries, authz, persistence, observability)
- [ ] Third-order effects reviewed (operator workflow, incident/debug path, docs/runbooks)
- Summary:

## Acceptance Criteria Mapping

List each relevant acceptance criterion and how this PR satisfies it.

- Criterion:
  - Evidence:

## Test Plan

- npm run lint
- npm run typecheck
- npm run build
- npm run test
- npm run smoke:mobile:ios (macOS local smoke; if mobile/deep-link navigation changed)
- npm run verify (repo root: matches CI `checks` — lint, typecheck, test, **workspace builds including mobile `expo export`**)
- Manual checks (if applicable)

## Maintainability Checklist (required)

- No duplicate API/outbox/client logic introduced
- File/module placement follows monorepo layering (contracts -> api -> client/sync -> UI -> docs)
- Complex branches include intent comments where useful
- Docs updated for workflow/operational changes
- A new contributor can trace this feature from contract to UI

## Dual-Client Architecture Checklist (required when touching contracts/API/client-sync)

- Contract/API changes are client-agnostic (mobile + web compatible)
- No mobile-specific semantics leaked into contracts/routes
- Server remains source of truth for domain outcomes
- `npm run verify:dual-client` passes
- Updated `docs/sdlc/dual-client-architecture-guardrails.md` if architecture boundaries changed

## Risk and Rollback

- Risk level: low / medium / high
- Rollback approach:

## Agent Notes (if agent-assisted)

- Prompt/task used:
- What was reviewed manually:
- Handoff doc updated (`docs/sdlc/agent-handoff.md`): yes / no
- Successor next-step prompt prepared: yes / no

## Agent Handoff Continuity Checklist (required for agent-assisted PRs)

- Current roadmap phase is explicitly stated
- Active issue and acceptance criteria are restated before implementation
- Changed files are listed with rationale and layering compliance
- "Do-not-change" guardrails are listed for this PR
- Remaining tasks and blockers are documented for successor agent
- Validation evidence includes command summary and manual/staging checks where applicable

## Token Budget Check (required for agent-assisted PRs)

- Used `docs/sdlc/token-budget.md` as context policy
- Kept context to canonical docs + task-specific files only
- Avoided broad/redundant doc summaries in agent notes
- Updated `docs/sdlc/agent-handoff.md` with delta-only current state
- Successor prompt is short, scoped, and actionable

