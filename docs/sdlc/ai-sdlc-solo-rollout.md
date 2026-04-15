# CrewCue AI SDLC (Solo Rollout)

This rollout is optimized for one developer, no hard launch date, and low process overhead.

## Current Recommendation

Use phased autonomy:

- configure everything now
- enable only high-ROI loops immediately
- keep production-critical decisions human-approved

## Phase A (Enable Now)

### Goal

Ship WS1 faster with fewer regressions and low orchestration complexity.

### Enabled Loops

1. spec-driven task slicing from workstream plans into small implementation tasks
2. coding agent implementation on short-lived branches
3. deterministic CI checks and local verification
4. human final review for behavior, scope, and acceptance criteria

### Disabled for Now

- autonomous SRE remediation
- automatic production changes by agents
- broad repository-wide autonomous refactors

## Working Agreement (Solo)

1. Every change starts from a scoped task linked to one workstream objective.
2. Keep tasks small enough to complete in one PR.
3. Require passing quality gates before merge:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`
   - `npm run test`
4. Do not allow agent commits directly to `main`.
5. Keep business-critical behavior behind explicit acceptance checks.

## WS1 Execution Pattern

For each WS1 feature:

1. Write a short task using the issue template.
2. Reference exact acceptance criteria from `ws1-race-rooms-access-and-billing-plan.md`.
3. Have the coding agent implement on a feature branch.
4. Validate locally and in CI.
5. Merge only after human review confirms room auth, roles, and entitlement behavior.

## Promotion Gates (A -> B)

Move to Phase B only when all are true for at least 2-3 consecutive PRs:

- no rollback needed after merge
- CI green on first or second attempt
- review feedback mostly polish-level (not architecture corrections)
- acceptance criteria mapped and verified in every PR

## Phase B (Later)

- AI-assisted PR quality review comments
- issue auto-triage and bug clustering
- tighter test generation per acceptance criterion

## Phase C (Much Later)

- SRE-agent diagnostics in staging
- automatic issue creation from incidents
- no autonomous production remediation yet

## Definition of Fast for CrewCue

Fast means:

- less rework
- clear diffs
- reliable merges
- predictable WS completion

Not:

- maximum agent autonomy on day one
