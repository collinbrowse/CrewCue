# SDLC docs map

This directory contains both active execution docs and historical references.
Use the sections below to avoid stale-doc confusion during implementation.

---

## Canonical docs (authoritative for active work)

1. `agent-handoff.md` - Required start/end continuity artifact for agent-assisted work.
2. `token-budget.md` - Context-window and token-usage policy for efficient agent execution.
3. `mvp-ui-development-spec.md` - Implementation-ready MVP UI requirements and acceptance criteria.
4. `ui-delivery-roadmap-and-spec.md` - Demo-first Epic roadmap, Sprint sequencing, and Backlog ordering.
5. `dual-client-architecture-guardrails.md` - Mobile/web architecture boundaries.
6. `codebase-maintainability-standard.md` - Reuse, layering, and maintainability rules.
7. `github-issues-and-prs.md` - Issue/PR execution workflow.
8. `staging-first-cloud-delivery.md` - Named cloud rollout phases (Postgres/events, auth/payments, staging clients, projection/sync) and staging-first rules.
9. `ios-simulator-agent-qa.md` - Agent/XcodeBuildMCP simulator validation (evidence on PR only).
10. `agent-async-delivery-program.md` - Wave DAG, Ready/Done, edge-case matrix, async agent launch for crew schedule + AI pacing.

If instructions conflict, follow in this order:
`agent-handoff.md` -> `token-budget.md` -> `agent-async-delivery-program.md` (when executing that program) -> `mvp-ui-development-spec.md` -> `ui-delivery-roadmap-and-spec.md` -> `staging-first-cloud-delivery.md` (when cloud/staging scope applies) -> architecture/maintainability standards.

---

## Archive doc (non-authoritative by default)

Use only for concise historical context:

- `archive-completed-work-summary.md`

---

## Consolidation notes

- Completed execution/signoff/history docs are removed from active SDLC flow.
- Keep active planning and guardrail docs short; move finished history into the single archive doc above.
