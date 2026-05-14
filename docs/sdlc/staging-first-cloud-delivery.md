# Staging-first cloud delivery

**Audience:** engineers and agents changing **cloud-backed behavior** (databases, identity, payments, staging/prod rollout, or proving clients against real staging).

**When to read this:** work goes beyond the in-repo API/contract baseline into durable Postgres, Auth0, payments, environment-specific behavior, or end-to-end client proof on **staging**.

---

## Phases at a glance

Delivery is sequenced in **four named phases**. Use these names in issues, PRs, and project boards—not letter codes.

| Phase | What it means | Optional GitHub label |
| --- | --- | --- |
| **Postgres & event log** | Staging Postgres, migrations, and the persistence/event-log direction in [ADR 0003](../adr/0003-canonical-data-and-event-log.md). | `postgres-event-log` |
| **Auth & payments (staging)** | Auth0 integration and payments behavior on staging per [ADR 0004](../adr/0004-cloud-iac-auth-baseline.md). | `auth-payments-staging` |
| **Clients prove staging** | Mobile and web exercised end-to-end against **staging** (not production-first assumptions). | `staging-client-e2e` |
| **Projection & sync hardening** | Deeper live projection, sync health, and contract-backed reads. After Postgres is authoritative, **do not** treat in-memory stores as the source of truth again. | `projection-sync-hardening` |

---

## Staging-first rule

Ship and soak **cloud-only** behavior on **staging** before relying on it in production.

---

## Pickup checklist (humans and agents)

- Which **phase** in the table above does this change advance?
- Which **ADRs** gate the work (0003 persistence vs 0004 identity/cloud)?
- Which **environments** are touched (local / staging / production)?
- For client work: are we validating against **staging** URLs and credentials?

---

## Related docs

- [GitHub issues and pull requests](./github-issues-and-prs.md) — how tasks link to PRs and merge.
- [UI delivery roadmap and specification](./ui-delivery-roadmap-and-spec.md) — client epic order and UI guardrails.
