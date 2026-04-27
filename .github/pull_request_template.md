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

## Acceptance Criteria Mapping

List each relevant acceptance criterion and how this PR satisfies it.

- Criterion:
  - Evidence:

## Test Plan

- npm run lint
- npm run typecheck
- npm run build
- npm run test
- npm run smoke:mobile:startup
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

