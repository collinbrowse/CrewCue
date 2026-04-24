# Dual-client architecture guardrails (mobile + web)

**Audience:** engineers and AI agents preparing CrewCue for separate mobile and web applications.  
**Intent:** keep domain/backend behavior client-agnostic so new clients can attach without backend rewrites.

**Scope note:** this document defines architecture and delivery guardrails only. It does **not** require building web UI now.

---

## 1) Target architecture (Path B)

CrewCue supports two first-class clients against one backend platform:

- `apps/mobile` -> field-first mobile UX (Expo/React Native)
- `apps/web` -> desktop/laptop operator UX (future app; separate UI)
- shared backend platform:
  - `packages/contracts` -> canonical request/response/event/auth shapes
  - `services/api` -> canonical domain rules, authz, persistence, projections

Design rule: clients may differ in UX, but they must consume the same contracts and server semantics.

---

## 2) Non-negotiable boundaries

1. **Server authority**
   - Domain and workflow rules live in `services/api`.
   - Clients never become alternate authorities for room/task/projection outcomes.

2. **Contract authority**
   - API payloads and enums are defined in `packages/contracts`.
   - Do not introduce app-specific variants of the same contract shape.

3. **Client isolation**
   - `apps/mobile` and future `apps/web` may diverge in presentation/layout.
   - Cross-client duplication of transport/state rules should be extracted into shared modules only when reused by both.

4. **No mobile-only assumptions in backend**
   - Avoid naming and logic that encode mobile UI semantics in routes/contracts.
   - Prefer neutral operation terms (e.g., room/task/checkpoint verbs) over client-driven naming.

---

## 3) Readiness checklist before creating `apps/web`

These steps can be completed now without implementing web UI screens.

1. **Contract audit**
   - Ensure current endpoint DTOs and enums are neutral (no mobile-specific field names).
   - Add/adjust contract tests where drift risk exists (auth claims, sync statuses, stoppage/source toggles).

2. **API surface audit**
   - Confirm every operator workflow is represented by route + contract (not UI-only behavior).
   - Move any implicit client workflow assumptions into explicit API validation/errors.

3. **Client transport boundary clarity**
   - Keep `apps/mobile/src/api/client.ts` as the only network entry point in mobile.
   - Keep outbox behavior centralized in `apps/mobile/src/sync/*`.
   - When web begins and logic repeats, extract shared client-core modules into `packages/*` (or documented shared app module) rather than copy/paste.

4. **Auth and role mapping neutrality**
   - Keep role checks and permissions server-side.
   - Treat client claims as input hints; API remains final authority.
   - Ensure role/claim docs avoid client-specific assumptions.

5. **Operational verification neutrality**
   - Keep smoke/runbook steps API-centric so any client can execute them.
   - Avoid validation steps that require one specific UI implementation unless clearly labeled.

---

## 4) PR gating rules for dual-client safety

Any PR that changes contracts, routes, authz, outbox semantics, or sync semantics must confirm:

- [ ] Change is client-agnostic at contract/API layer
- [ ] No mobile-specific naming leaked into backend contracts/routes
- [ ] Server remains source of truth for domain outcomes
- [ ] Tests cover behavior below UI layer (contracts/API/outbox where applicable)
- [ ] Docs updated if a new client-facing assumption is introduced

If a change fails any item above, it is not merge-ready for dual-client architecture.

---

## 5) Implementation order for future web start (no UI yet)

When web implementation begins, use this order:

1. Confirm contracts + API are sufficient (add missing capabilities first).
2. Extract shared client-core logic only where duplication appears.
3. Create `apps/web` app shell and wire auth/config.
4. Build web workflow screens against existing client-core/API contracts.
5. Run staging verification that compares mobile and web behavior for the same workflows.

This keeps both clients convergent on behavior while allowing specialized UX.

---

## 6) Revision history

| Date | Change |
| --- | --- |
| 2026-04-24 | Initial publication of dual-client (mobile + web) architecture guardrails and readiness checklist. |
