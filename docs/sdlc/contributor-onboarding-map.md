# Contributor onboarding map (humans + agents)

**Audience:** first-time contributors and AI agents picking up tasks.  
**Goal:** provide a fast path to understanding where logic lives and how to trace behavior across the monorepo.

---

## 1) Start here in order

1. [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md)  
2. [ui-delivery-roadmap-and-spec.md](./ui-delivery-roadmap-and-spec.md)  
3. [codebase-maintainability-standard.md](./codebase-maintainability-standard.md)  
4. [github-issues-and-prs.md](./github-issues-and-prs.md)

---

## 2) Monorepo map

| Path | Purpose | Start files |
| --- | --- | --- |
| `packages/contracts` | Shared types and contracts | `packages/contracts/src/index.ts` |
| `services/api` | Fastify API + persistence + authz | `services/api/src/server.ts`, `services/api/src/routes/raceRooms.ts` |
| `apps/mobile` | Expo mobile UI + sync/outbox | `apps/mobile/App.tsx`, `apps/mobile/src/api/client.ts`, `apps/mobile/src/sync/outboxProcessor.ts` |
| `docs/sdlc` | Delivery strategy/runbooks/policies | chunk docs and standards |

---

## 3) Trace a feature end-to-end

Use this sequence for debugging or implementation:

1. Contract type in `packages/contracts/src/index.ts`
2. API route and domain logic in `services/api/src/routes/*`
3. Persistence functions in `services/api/src/lib/roomPersistence.ts` (or related libs)
4. Client method in `apps/mobile/src/api/client.ts`
5. Outbox operation (if mutation/offline) in `apps/mobile/src/sync/*`
6. UI section/component in `apps/mobile/App.tsx` or `apps/mobile/src/components/*`
7. Tests in matching API/mobile test files

---

## 4) High-value runtime files

### API

- `services/api/src/routes/raceRooms.ts` -> room lifecycle + projection + stoppage mutations
- `services/api/src/plugins/auth.ts` -> request auth + identity mapping
- `services/api/src/lib/roomPersistence.ts` -> persistence mode + Postgres tables + load/persist helpers
- `services/api/src/routes/health.ts` -> persistence mode observability

### Mobile

- `apps/mobile/App.tsx` -> top-level orchestration
- `apps/mobile/src/components/OperationalSummarySections.tsx` -> operational cards/sections
- `apps/mobile/src/api/client.ts` -> all server calls
- `apps/mobile/src/sync/outboxStore.ts` / `outboxProcessor.ts` -> offline mutation path
- `apps/mobile/src/auth/useAuth.ts` -> Auth0 sign-in/token lifecycle

---

## 5) “Where should this change go?” quick guide

| You need to change... | Put code in... |
| --- | --- |
| API payload shape or enums | `packages/contracts` first |
| server business rule | `services/api/src/routes` + `services/api/src/lib` |
| DB load/save behavior | `services/api/src/lib/roomPersistence.ts` or persistence adapters |
| mobile fetch/mutation transport | `apps/mobile/src/api/client.ts` |
| offline queue behavior | `apps/mobile/src/sync/*` |
| UI rendering and interactions | `apps/mobile` + extracted components |
| rollout/operator steps | `docs/sdlc/*` |

---

## 6) Common pitfalls to avoid

- Implementing UI behavior without confirming contract/API support
- Adding duplicate client methods for existing endpoints
- Creating second retry queues outside outbox
- Shipping cloud changes without staging verification evidence
- Leaving operational flow changes undocumented

---

## 7) First 15-minute checklist for a new task

1. Read the linked issue objective + acceptance criteria
2. Identify chunk/phase from SDLC docs
3. Locate contract and existing API/outbox paths
4. Confirm source of truth and test location
5. Implement in layered order (contract -> API -> client/outbox -> UI -> docs)

---

## 8) Revision history

| Date | Change |
| --- | --- |
| 2026-04-24 | Initial contributor onboarding map for humans and agents. |
