# UI delivery roadmap and specification (MVP -> pilot-ready)

**Audience:** product engineers, operators, and AI coding agents implementing CrewCue client UI.  
**Intent:** define what UI to build, when to build it, and how each layer reuses prior work so we avoid duplicate implementation.

**Related docs:**  
- [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md)  
- [dual-client-architecture-guardrails.md](./dual-client-architecture-guardrails.md)  
- [chunk-c-mobile-auth0.md](./chunk-c-mobile-auth0.md)  
- [chunk-c-smoke-script.md](./chunk-c-smoke-script.md)  
- [chunk-d-d1-checkpoint-stoppage-time.md](./chunk-d-d1-checkpoint-stoppage-time.md)  
- [merge-concurrency-policy.md](./merge-concurrency-policy.md)

---

## 1) Product UI objective

CrewCue UI must enable race-day operations end-to-end for:

- athlete
- crew member / crew chief
- team manager

The UI roadmap is **operations-first**:

1. ship usable workflows quickly
2. harden reliability and conflict behavior
3. polish presentation only after workflows are stable

This is deliberate. Building polished visuals before flow reliability creates rework and hides core state bugs.

---

## 2) Current baseline (as of this spec)

- Auth + staging integration is working (Chunk B/C)
- Mobile single-screen shell exists in `apps/mobile/App.tsx`
- WS2 stoppage endpoints + UI controls exist (manual stop, source toggle)
- Outbox foundation exists and supports checkpoint operations
- Staging API now runs with Postgres persistence enabled

Implication: UI work should now move from "smoke shell" toward "structured operational UI" without rebuilding auth/network primitives.

For web expansion, this document governs workflow priorities while [dual-client-architecture-guardrails.md](./dual-client-architecture-guardrails.md) governs architecture boundaries. If those conflict, architecture guardrails win.

---

## 3) Non-negotiable design principles

### 3.1 Flow-first over polish-first

- Prioritize complete workflows over visual refinement.
- Every new screen/state must correspond to a real race operation.

### 3.2 Single source of truth

- Server state is authoritative for room/projection/task/timeline.
- Local state is for optimistic UX and offline queues only.

### 3.3 Reuse over rewrite

Before adding UI/state code, check existing:

- API client methods (`apps/mobile/src/api/client.ts`)
- outbox payload types + processing (`apps/mobile/src/sync/outbox*`)
- auth/identity hooks (`apps/mobile/src/auth/*`)

If similar logic exists, extend it. Do not fork equivalent paths.

### 3.4 Explicit freshness

- Show stale/pending/conflict status in UI.
- Never imply "synced" when data is queued or unknown.

### 3.5 Role-aware by default

- UI must respect WS1 role boundaries.
- Controls that mutate race operations should render only when allowed, and be validated server-side.

---

## 4) UI architecture constraints (to minimize duplication)

### 4.1 State layering

Use this order for new UI state:

1. **Remote state** (fetched from API)  
2. **Local derived view state** (sorting/filter/expanded rows)  
3. **Outbox intent state** (queued offline mutations)  
4. **Ephemeral input state** (forms/buttons/timestamps)

Do not store API response clones in multiple places unless there is a clear synchronization strategy.

### 4.2 Shared modules first

Any logic used by more than one screen/component should live in `src/` modules, not inline component bodies.

Target extraction order:

1. `src/features/*` domain helpers
2. `src/components/*` presentational units
3. `App.tsx` reduced to orchestration and route composition

### 4.3 Outbox mutation contract

All offline-capable mutating actions should:

1. enqueue canonical outbox operation
2. show immediate queued feedback
3. rely on outbox processor for API execution
4. re-fetch/read authoritative state after flush

Do not add parallel "fire-and-forget fetch" paths for the same operation type.

---

## 5) Phased roadmap (explicit build order)

Each phase should build on previous phases. Do not skip ordering unless issue-specific context explicitly says so.

## Phase 0 - Stabilize existing shell (complete)

**Goal:** prove cloud wiring and end-to-end smoke operations.

Delivered:

- Auth0 sign-in
- room create/activate/entitlement
- ping + projection fetch
- stoppage controls in shell

Exit gate:

- staging smoke passes and basic operator path works manually

## Phase 1 - Operational mobile UI shell (now -> next)

**Goal:** turn the single-page shell into a structured MVP operator UI without changing backend contracts.

Build:

- Sectioned layout (Room, Projection, Checkpoints, Outbox, Sync, Timeline)
- Projection split list with stoppage summary always visible after fetch
- Checkpoint action cards (enter/exit, source toggle) with role/freshness gating
- Unified status rail (`last success`, `last error`, `pending count`, `stale`)

Reuse requirements:

- Keep existing API client and outbox contract
- Extract repeated render/state helpers from `App.tsx` before adding new controls

Exit gate:

- Crew can run stoppage flow from structured UI with no curl
- No duplicate fetch/mutation implementations

## Phase 2 - WS5 resilience UI (D2)

**Goal:** make offline/poor-connectivity behavior explicit and actionable.

Build:

- Outbox queue inspector (per operation, attempts, status, feedback)
- Sync health panel (device staleness + pending counts)
- Conflict resolution UX for merge-policy outcomes
- Retry controls scoped to safe operations

Dependencies:

- [merge-concurrency-policy.md](./merge-concurrency-policy.md) must be current

Reuse requirements:

- Extend existing outbox operation types and processor
- Do not introduce a second retry queue

Exit gate:

- Operators can distinguish pending vs conflict vs rejected and recover in-app

## Phase 3 - WS3/WS4 operation depth UI

**Goal:** round out race operations beyond stoppage timing.

Build:

- Task board UX (assign/start/complete) with role-scoped views
- Protocol notes + timeline as first-class panels
- Structured incident capture + recommendation display
- Plan delta view (before/after) for adaptive loop visibility

Reuse requirements:

- Use existing timeline/task API surfaces
- Keep event semantics aligned with WS7 contracts

Exit gate:

- Incident-to-plan-update workflow complete in app

## Phase 4 - UX polish and navigation hardening

**Goal:** improve usability after core flow and resilience stabilize.

Build:

- Navigation architecture cleanup
- visual system consistency
- accessibility + large-text support
- interaction latency optimization

Rule:

- No major design-system effort before Phases 1-3 are field-validated.

Exit gate:

- Core race-day flows are easier/faster to execute without changing backend contracts.

## Phase 5 - WS6 manager command center (deferred / last priority)

**Goal:** multi-athlete operational visibility for team managers, after core athlete+crew value is already in users' hands.

Build:

- Roster/athlete board view
- Configurable status cards (calories/hr, carbs/hr, electrolytes/hr, sodium/hr)
- Overlap/conflict views across checkpoints
- Drill-down into per-athlete operational state

Reuse requirements:

- Reuse projection/task/sync primitives from prior phases
- Avoid duplicating per-athlete feature logic with manager-only variants; compose shared components

Defer rule:

- Do not start WS6 manager command center while any of Phases 1-3 exit gates are open.
- Treat this phase as post-MVP hardening/expansion unless product priorities explicitly change.

Exit gate:

- Manager can triage multiple athletes without switching tools.

---

## 6) UI capability matrix by workstream

| Workstream | MVP UI requirement | First phase |
| --- | --- | --- |
| WS1 | role-aware room lifecycle UI | Phase 1 |
| WS2 | projection + checkpoint stoppage controls | Phase 1 |
| WS3 | crew task execution + notes/timeline | Phase 3 |
| WS4 | incident capture + adaptive recommendation view | Phase 3 |
| WS5 | outbox/sync/conflict visibility and recovery | Phase 2 |
| WS6 | multi-athlete manager board | Phase 5 (deferred) |
| WS7 | contract-backed state and replay-safe semantics | cross-cutting |

---

## 7) Monorepo-first execution order (global, not per-project)

Use this order across the entire monorepo so UI, API, sync, and ops work stay aligned:

1. **Contracts + backend capability**
   - add/adjust contracts in `packages/contracts`
   - implement API route + persistence + authz in `services/api`
   - add API tests first
2. **Client transport + outbox plumbing**
   - wire `apps/mobile/src/api/client.ts`
   - add/update outbox payload types and processor behavior
   - add unit tests for outbox processing/conflict behavior
3. **UI workflow layer**
   - add/adjust screens/components using existing client/outbox primitives
   - avoid inline network logic in view components
4. **Operational docs and smoke updates**
   - update chunk/runbook docs
   - update smoke scripts/checklists if the operator flow changed
5. **Staging verification before merge**
   - verify health/runtime on staging for cloud-touching changes
   - only then merge to `main`

This order is mandatory for phases 1-3. Phase 5 (WS6) only starts after the same chain is already stable.

---

## 8) Anti-duplication rules for agents

Before implementing any UI issue, an agent must:

1. list existing client methods and outbox types touched by the feature
2. identify whether the new feature is:
   - **new operation type** (add once in client + outbox + UI), or
   - **new presentation of existing operation** (UI only)
3. avoid adding duplicate API methods with slightly different names
4. avoid adding duplicate enum/string constants for status values
5. add tests at the lowest reusable layer first (state helper/outbox processor), then UI integration

If a task would duplicate existing logic, refactor shared modules first, then add the new UI.

---

## 9) Required documentation updates per phase

Each merged UI phase should update:

1. this file (`ui-delivery-roadmap-and-spec.md`) revision history
2. relevant chunk doc(s) (Chunk C for shell changes, Chunk D stream doc for depth changes)
3. smoke/runbook docs if operator steps change

No "silent UI architecture changes" in PRs without doc updates.

---

## 10) PR acceptance checklist for UI work

A UI PR is not complete unless all apply:

- [ ] maps to a specific roadmap phase in this doc
- [ ] reuses existing API/outbox contracts or clearly refactors them
- [ ] includes offline/error/freshness behavior for modified workflows
- [ ] includes tests for new state/mutation behavior
- [ ] includes staging validation notes (manual or automated)
- [ ] updates docs where operator workflow changed

---

## 11) Revision history

| Date | Change |
| --- | --- |
| 2026-04-24 | Initial publication: phased UI roadmap, architecture constraints, anti-duplication rules, and PR checklist. |
| 2026-04-24 | Reordered priorities so WS6 manager command center is deferred to Phase 5 (last priority) and added explicit monorepo-first execution order. |
