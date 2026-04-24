# Codebase maintainability standard

**Audience:** all contributors (humans and AI agents).  
**Intent:** make code understandable, navigable, and safe to extend without hidden coupling.

**Related docs:**  
- [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md)  
- [ui-delivery-roadmap-and-spec.md](./ui-delivery-roadmap-and-spec.md)  
- [dual-client-architecture-guardrails.md](./dual-client-architecture-guardrails.md)  
- [github-issues-and-prs.md](./github-issues-and-prs.md)

---

## 1) Definition of done (maintainability)

A change is not complete unless a new contributor can answer:

1. **Where is the feature implemented?**
2. **What is the source of truth for its state?**
3. **How does data flow from input to persistence to UI?**
4. **Where are tests that prove the behavior?**

If those answers are unclear, the PR is incomplete even when tests pass.

---

## 2) Structure rules (monorepo)

Use these top-level boundaries consistently:

- `packages/contracts` -> shared DTO/event/auth contracts; no app-specific UI logic
- `services/api` -> server routes, domain logic, persistence, authz, replay/projections
- `apps/mobile` -> client presentation, user interaction, sync/outbox orchestration
- `apps/web` -> desktop/laptop client presentation (when created); consumes same contracts/API semantics
- `docs/sdlc` -> execution plans, runbooks, and operating policy

Do not duplicate domain rules across API and mobile. Domain authority stays server-side unless explicitly designed for offline behavior.
Do not encode client-specific behavior in contracts/routes unless the behavior is truly client-specific and documented.

---

## 3) Flow layering rules

Every feature should follow this order:

1. **Contracts** (`packages/contracts`)
2. **Server behavior + tests** (`services/api`)
3. **Client transport/sync plumbing + tests** (`apps/mobile/src/api`, `apps/mobile/src/sync`)
4. **UI composition** (`apps/mobile`)
5. **Runbook/spec updates** (`docs/sdlc`)

Avoid writing UI-first code that invents behavior not yet represented in contracts/routes.

---

## 4) File and module hygiene

### 4.1 File size and extraction

- If a file exceeds ~300-400 lines and mixes orchestration + rendering + state transitions, extract modules.
- Keep `App.tsx` and top-level route files orchestration-focused.
- Move repeated render blocks into `src/components/*`.
- Move non-trivial state/derivation logic into `src/features/*` or `src/lib/*`.

### 4.2 Naming

- Prefer names that encode role: `*Routes`, `*Client`, `*Store`, `*Processor`, `*Section`.
- Avoid generic names like `utils.ts` for domain-specific logic.

### 4.3 Duplication

Before adding code, search for existing:

- API client methods
- outbox operation types/processors
- status enums and error mapping

Extend existing paths before creating new parallel ones.

---

## 5) Commenting standard

Comments should explain **intent and constraints**, not obvious syntax.

Good comment examples:

- why a fallback exists
- why a branch is safe in race/offline conditions
- why a behavior is staging-only

Avoid comments that restate code mechanics ("sets variable x").

For complex workflows, prefer short section headers over dense inline comments.

---

## 6) State and source-of-truth policy

- Server is authoritative for room/task/projection/timeline state.
- Outbox is authoritative for local pending mutation intent.
- UI local state is view/input state only.

Never silently merge server snapshots and local optimistic state without explicit conflict handling.

---

## 7) Testing minimums by change type

| Change type | Required test coverage |
| --- | --- |
| New API behavior | Route/unit tests in `services/api` |
| New outbox operation/mutation path | Outbox processor/store tests |
| UI-only view composition | At least affected unit tests + manual staging validation notes |
| Persistence/auth changes | Staging verification evidence in docs/issue comments |

If no automated test is practical for a UI slice, include a deterministic manual validation checklist in the PR.

---

## 8) PR maintainability gates (required)

Every PR should explicitly confirm:

- [ ] No duplicate API/outbox logic introduced
- [ ] Code is discoverable by path and naming
- [ ] Complex flows include intent comments where needed
- [ ] Relevant docs were updated for operator/developer workflow changes
- [ ] A new contributor could trace request -> server -> persistence -> UI with current docs

---

## 9) Documentation obligations

Update docs when:

- build order or roadmap priority changes
- operational setup changes
- user-facing workflows change
- state ownership or conflict semantics change

Never rely on chat history as the only record of why a pattern exists.

When architecture intent includes multiple clients (mobile + web), update [dual-client-architecture-guardrails.md](./dual-client-architecture-guardrails.md) if boundaries or layering rules change.

---

## 10) Revision history

| Date | Change |
| --- | --- |
| 2026-04-24 | Initial publication of codebase maintainability standard. |
| 2026-04-24 | Added explicit dual-client references and rules to preserve mobile + web architecture boundaries. |
