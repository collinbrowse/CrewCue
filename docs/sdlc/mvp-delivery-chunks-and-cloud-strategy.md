# MVP delivery chunks and cloud strategy

**Audience:** engineers, operators, and AI coding agents picking up work after WS0–WS7 foundation sprints.  
**Intent:** one place to learn **what to build next**, **where it runs** (local vs cloud), and **how to ship** without re-deriving strategy from chat history.

**Related:** [athlete-support-operations-plan.md](../../athlete-support-operations-plan.md) (product scope) · [GitHub issues and PRs](./github-issues-and-prs.md) (task workflow) · [WS0 readiness sign-off](../ws0-readiness-signoff.md) · [ADR 0003](../adr/0003-canonical-data-and-event-log.md) · [ADR 0004](../adr/0004-cloud-iac-auth-baseline.md)

---

## 1. Why this doc exists

Workstreams **WS1–WS7** delivered a **broad API and contract surface** mostly on **in-memory** stores suitable for demos and integration tests. A **functioning MVP** (multi-user, restart-safe, field-usable) requires:

1. **Durable truth** in a cloud database (and eventually an append-only event log in PostgreSQL per ADR 0003).
2. **Real identity** (Auth0 per ADR 0004) so ACLs, team surfaces, and audit trails match reality.
3. **Real or pilot-grade entitlement** so “paid room” is enforceable outside engineering toggles.
4. **Client applications** that exercise the same paths against **staging** before production.

This doc defines **four delivery chunks (A–D)** and embeds the **cloud promotion strategy** so chunks and environments stay aligned.

---

## 2. Core principles (do not skip)

| Principle | Meaning |
| --- | --- |
| **Local for velocity** | Developers run the API (and optional local Postgres) for fast feedback. |
| **Staging for truth** | The first environment where **shared** state, **Auth0**, and **test-mode payments** must behave like production. |
| **Production for pilots** | Same code paths as staging; stricter secrets, backups, SLOs, and change control. |
| **Single write spine** | Avoid maintaining two authorities (in-memory Maps vs DB vs event log). New work should **converge** on one model: either **commands persist to Postgres and emit `PlatformEventEnvelope`**, or **append-only log is source of truth** with projections—pick one per bounded context and document it in an ADR before large migrations. |
| **Staging-first cloud** | **Never** introduce Postgres-only or Auth0-only behavior in production first. |

---

## 3. Environment ladder (official)

| Environment | Purpose | Typical data | Auth | Payments |
| --- | --- | --- | --- | --- |
| **Local** | Fast iteration, unit/API tests | Optional Docker Postgres; else in-memory only for legacy paths | Dev JWT (current API baseline) or local validation only | Manual `paid` / stub |
| **Staging** | **Integration truth** for team + mobile + web | **Cloud Postgres** (required once Chunk A lands); event log when wired | **Auth0** (staging tenant/app) | **Provider test mode** + webhooks to staging URL |
| **Production** | Pilots and paying users | Cloud Postgres + backups | Auth0 production | Live payments when ready |

**Promotion rule:** a capability is **“cloud complete”** only when it works on **staging** with **Auth0-backed identities** (Chunk B) and documented rollback (see WS0 readiness limitations).

---

## 4. Delivery chunks (A–D) with cloud work embedded

Chunks are **sequenced layers**, not a reinvention of WS1–WS7. WS numbers still label issues; **chunk labels** (`chunk-a`, …) should appear on GitHub issues/PRs when work maps cleanly.

### Chunk A — Persistence spine (database + event log path)

**Goal:** Restart-safe race operations; align runtime with ADR 0003 (append-only `domain_events`, projections over time).

**Current sprint ladder:** [chunk-a-sprint1-execution.md](./chunk-a-sprint1-execution.md)

**Ships (examples):** PostgreSQL schema and migrations for race rooms, memberships, invites, entitlement, tasks/incidents/plan data as designed; wire **WS7** `appendPlatformEvent` (or successor) to **persisted** storage; repository boundaries so the API is not a giant `Map`.

**Cloud in this chunk**

- Provision and use **staging Postgres** (Terraform baseline already exists under `infra/` per WS0).
- CI applies migrations to **staging** on merge to the agreed branch (e.g. `main` or `develop`—team choice; document it here when fixed).
- **Production** Postgres follows the same migration path **after** staging soak.

**Exit criteria (gate)**

- API can **lose a process** and **retain** room + crew + plan state on staging.
- Replay or read-model rebuild path is **documented** (even if v1 is “rebuild from events for one aggregate only”).

**Risks**

- **Split brain** between old in-memory routes and new DB—mitigate with strangler flags or module ownership per route group.

---

### Chunk B — Identity and entitlement (Auth0 + payments)

**Goal:** Every human and device maps to a stable identity; paid access is defensible.

**Ships (examples):** Auth0 integration validating JWTs in the API; claim mapping (`sub`, `teamIds`, `roomRoles`) consistent with WS1/WS6; webhook or admin flow updating **entitlement** in Postgres; remove or narrow dev-only auth bypass on staging.

**Cloud in this chunk**

- **Auth0** applications for **staging** first, then production clone.
- **Payment provider** (choice per ADR 0004) in **test mode** hitting **staging** webhooks.
- Secrets in cloud secret manager—not repo env files.

**Exit criteria (gate)**

- A non-engineer can complete **sign-in → join/create room → paid access** on **staging** using real Auth0 and test payments (or a documented pilot bypass **only** in staging).

**Dependency:** Chunk A schema exists for users/rooms/entitlement rows (or equivalent).

**Risks**

- Claim shape drift breaks WS6 command center—mitigate with **contract tests** for JWT payload expectations.

---

### Chunk C — End-to-end client MVP (proves the cloud stack)

**Goal:** Athlete + crew (+ manager if Phase 1 demands) run race-day flows **in the app** against **staging**.

**Ships (examples):** Mobile: config for staging `API_BASE_URL`, Auth0 login, room lifecycle, pings, projection UI, task board, incidents/recommendations path, optional sync panel (WS5 heartbeats). Manager tablet/web optional but recommended for WS6 “essentials.”

**Cloud in this chunk**

- Clients talk to **staging API** only until release discipline exists.
- No new server features required for “cloud” here—**verification** and UX gaps are the work.

**Exit criteria (gate)**

- Scripted **smoke demo** (manual or automated) documented in-repo: sign-in → paid active room → ping → crew sees projection → task lifecycle → incident loop (as applicable).

**Dependency:** Chunks A and B green on staging.

**Risks**

- Latency and battery on polling—mitigate with backoff and later push transport; document MVP limits.

---

### Chunk D — Domain depth and resilience (parallel streams)

**Goal:** Deepen WS2–WS6 capabilities **without** collapsing back to ad-hoc memory stores.

**Organize as parallel streams** (one primary stream per sprint to reduce thrash):

| Stream | Example outcomes | Cloud notes |
| --- | --- | --- |
| **D1 — WS2 depth** | Baselines, weather stub or integration, richer course model | Store inputs in Postgres; cache if needed |
| **D2 — WS5 client resilience** | Offline queue, retry, idempotent mutations | Same staging API; exercise idempotency keys |
| **D3 — WS7 projections** | Snapshot tables, broader reducers, replay tooling | Jobs run in cloud (worker or cron); document rebuild SOP |
| **D4 — BLE / mesh (optional)** | Only if pilot evidence requires it | Often **device-local** first; server stays HTTP |

**Cross-cutting policy (do before deep D2):** write a **short merge concurrency policy** (per entity: task, protocol note, plan version, incident) so offline sync does not contradict WS7 authority.

**Exit criteria:** per-stream acceptance defined in the issue; no stream may reintroduce **in-memory as source of truth** for data that pilots need after Chunk A exit.

---

## 5. How to pick up a task (human or AI agent)

1. **Read this doc** and identify which **chunk (A–D)** or **stream (D1–D4)** the task belongs to.
2. **Check gates:** do not start Chunk C work if staging DB + auth are not yet available for that flow; do not start Chunk B production keys on a feature branch.
3. **Open a GitHub issue** (see [github-issues-and-prs.md](./github-issues-and-prs.md)): objective, acceptance criteria, **label** `chunk-a` / `chunk-b` / … as appropriate, link to ADRs if touching persistence or auth.
4. **Branch from `main`**, implement, **`npm run lint` / `npm run typecheck` / `npm run test`**, open PR with **`Closes #N`**.
5. **Verify on staging** when the task touches cloud behavior (DB, Auth0, webhooks)—local-only tests are insufficient for merge at gate boundaries.
6. **Update** this doc or ADRs only when strategy changes (avoid drive-by edits).

---

## 6. What “done” means for MVP cloud readiness (summary)

| Milestone | Meaning |
| --- | --- |
| **Cloud-ready (internal)** | Staging Postgres + migrations + API using DB for core aggregates |
| **Cloud-ready (external testers)** | Staging + Auth0 + payment test mode + mobile smoke path |
| **Pilot-ready** | Production equivalents + backups + on-call + rollback validated |

---

## 7. Runbook: enabling real infrastructure deploys

Use this checklist when you are ready for Terraform to actually create/update AWS resources from GitHub Actions.

### 7.1 Prerequisites

- Terraform config exists at `infra/terraform/environments/staging/`.
- `Deploy Staging` workflow exists at `.github/workflows/deploy-staging.yml`.
- You have an AWS IAM principal for CI with least-privilege access to the resources managed by this Terraform stack.

### 7.2 Configure GitHub staging environment secrets

In GitHub UI:

1. Repository → **Settings** → **Environments** → **staging**.
2. Under **Environment secrets**, add:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
3. (Optional) add environment protection rules (required reviewers) before Terraform apply.

Current behavior in the workflow:

- If AWS secrets are missing, Terraform steps are skipped and a notice is emitted.
- If AWS secrets are present, Terraform `init/plan/apply` runs.

### 7.3 First real deploy (staging)

1. Set API runtime environment variables for staging:
   - `PERSISTENCE_MODE=postgres`
   - `DATABASE_URL=<staging postgres connection string>`
2. Merge the infrastructure/code change to `main` (or trigger `workflow_dispatch` for `.github/workflows/deploy-staging.yml`).
2. Open Actions run `Deploy Staging` and confirm:
   - Build steps pass.
   - `Detect AWS credentials for Terraform` reports `terraform=true`.
   - `Terraform Init/Plan (staging)` succeeds.
   - `Terraform Apply` succeeds (after environment approval if configured).
3. Verify in AWS console for the target region (`us-east-1` by default in this repo) that expected resources exist or changed as planned.
4. Restart API and confirm previously created race rooms/invites are still retrievable.

### 7.4 Safe-operating practices

- Never commit AWS secrets to repo files; only store in GitHub environment secrets or cloud secret manager.
- Keep IAM scope narrow to staging resources where possible.
- For production, clone this same pattern with a separate `production` environment, separate credentials, and stricter approvals.
- Prefer moving to GitHub OIDC + AWS role assumption later to eliminate long-lived access keys.

### 7.5 Troubleshooting

- `terraform: command not found`:
  - Ensure workflow includes `hashicorp/setup-terraform`.
- `No valid credential sources found`:
  - Confirm `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set on the **staging** environment (not just repository secrets).
- Immediate workflow failure with no Terraform logs:
  - Check workflow syntax / expression errors in `.github/workflows/deploy-staging.yml`.

---

## 8. Persistence mode testing matrix

Use these modes to validate behavior consistently across local, CI, staging, and production.

| Target | Required env | Typical command |
| --- | --- | --- |
| Local fast/manual (memory) | `PERSISTENCE_MODE=memory` | `npm run dev:api:memory` |
| Local integration/manual (Postgres) | `PERSISTENCE_MODE=postgres`, `DATABASE_URL` | `npm run dev:api:pg` |
| API tests (memory lane) | `PERSISTENCE_MODE=memory` | `npm run test:memory` |
| API tests (Postgres lane) | `PERSISTENCE_MODE=postgres`, `DATABASE_URL` | `npm run test:pg` |
| Staging runtime | `PERSISTENCE_MODE=postgres`, `DATABASE_URL` | deploy workflow + readiness checks |
| Production runtime | `PERSISTENCE_MODE=postgres`, `DATABASE_URL` | production deploy workflow |

Validation rules:

- API startup fails fast when `PERSISTENCE_MODE=postgres` but `DATABASE_URL` is missing.
- Health endpoints (`/health/live`, `/health/ready`) expose active persistence mode for operator verification.

---

## 9. Revision history

| Date | Change |
| --- | --- |
| 2026-04-16 | Initial publication: chunks A–D merged with staging-first cloud strategy and pickup checklist. |
| 2026-04-16 | Added runbook for enabling real AWS Terraform deploys from GitHub staging environment. |
| 2026-04-16 | Added persistence mode matrix for local/manual/CI/staging/production workflows. |
