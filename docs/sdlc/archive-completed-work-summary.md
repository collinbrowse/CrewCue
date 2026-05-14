# Completed work archive (concise)

Purpose: keep one short record of already-finished delivery so active docs stay small.

## Completed foundation

- Cloud foundation delivered through the staging-first rollout (Postgres/event log, auth and payments on staging, staging client proof, projection/sync groundwork).
- Mobile app has authenticated shell and core operational scaffolding in place.
- API/contracts/client layering and anti-duplication guardrails are established and enforced in SDLC docs.

## Completed workstreams (historical)

- WS1: room lifecycle and role-aware access baseline.
- WS2: projection/stoppage controls and related operator flow foundations.
- WS3: task/protocol/timeline implementation baseline.
- WS4: incident/adaptive-plan implementation baseline.
- WS5: outbox/sync/conflict visibility baseline; safe-retry parity hardened; operator validation issue #179 completed.
- WS6: initial command-center slice completed (currently backlog/deferred by priority).
- WS7: contract/state-model and replay-safety baseline completed.

## Recent closure highlights

- PR #181 merged (handoff refresh), closing issue #180.
- Issue #179 closed with operator evidence for WS5 outbox validation behavior.
- Current strategy shifted to demo-first execution (see active roadmap/spec docs).

## Active docs to use now

- `docs/sdlc/agent-handoff.md`
- `docs/sdlc/README.md`
- `docs/sdlc/token-budget.md`
- `docs/sdlc/mvp-ui-development-spec.md`
- `docs/sdlc/ui-delivery-roadmap-and-spec.md`
- `docs/sdlc/dual-client-architecture-guardrails.md`
- `docs/sdlc/codebase-maintainability-standard.md`
- `docs/sdlc/github-issues-and-prs.md`
