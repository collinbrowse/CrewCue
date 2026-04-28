# SDLC docs map

This directory contains both active execution docs and historical references.
Use the sections below to avoid stale-doc confusion during implementation.

---

## Canonical docs (authoritative for active work)

1. `agent-handoff.md` - Required start/end continuity artifact for agent-assisted work.
2. `token-budget.md` - Context-window and token-usage policy for efficient agent execution.
3. `mvp-ui-development-spec.md` - Implementation-ready MVP UI requirements and acceptance criteria.
4. `ui-delivery-roadmap-and-spec.md` - Phased roadmap and gate ordering.
5. `mvp-delivery-chunks-and-cloud-strategy.md` - Chunk A-D delivery strategy and staging-first cloud policy.
6. `dual-client-architecture-guardrails.md` - Mobile/web architecture boundaries.
7. `codebase-maintainability-standard.md` - Reuse, layering, and maintainability rules.

If instructions conflict, follow in this order:
`agent-handoff.md` -> `token-budget.md` -> `mvp-ui-development-spec.md` -> `ui-delivery-roadmap-and-spec.md` -> architecture/maintainability standards.

---

## Historical and archive docs (non-authoritative by default)

Treat these as implementation records or audits unless explicitly referenced by an active issue/PR:

- `archive/2026-04/ws-implementation-history.md`
- `archive/2026-04/chunk-d-d1-ws2-implementation-and-validation.md`
- dated audits/signoff docs such as `dual-client-readiness-audit-2026-04-24.md`
- legacy execution sequence and sprint signoff docs

---

## Consolidation notes

- The WS execution/signoff family has been consolidated into:
  - `archive/2026-04/ws-implementation-history.md`
- The Chunk D D1 WS2 docs have been consolidated into:
  - `archive/2026-04/chunk-d-d1-ws2-implementation-and-validation.md`

Legacy files remain available for traceability but should not be used as default implementation entry points.
