# UI delivery roadmap and specification (MVP -> pilot-ready)

**Audience:** product engineers, operators, and AI coding agents implementing CrewCue client UI.  
**Intent:** define what UI to build, when to build it, and how each layer reuses prior work so we avoid duplicate implementation.

**Related docs:**  
- [README.md](./README.md)  
- [mvp-ui-development-spec.md](./mvp-ui-development-spec.md)  
- [agent-handoff.md](./agent-handoff.md)  
- [dual-client-architecture-guardrails.md](./dual-client-architecture-guardrails.md)  
- [codebase-maintainability-standard.md](./codebase-maintainability-standard.md)
- [github-issues-and-prs.md](./github-issues-and-prs.md)

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

## 5) Demo-first roadmap (explicit build order)

This roadmap now targets a customer-ready **demo build** as the top priority.

New terminology:

- **Epic** = a large delivery stage (replaces "phase")
- **Sprint** = a focused execution stream inside an epic (replaces "slice/chunk" language for UI planning)
- **Backlog** = deferred or non-demo work that stays tracked

Delivery rule: complete Epic A before Epic B unless an issue explicitly documents an exception.

## Epic A - Demo foundation (must ship first)

**Goal:** demo visual polish + core "what this app does" workflow coverage.

Sprints:

1. **DL1 - Welcome and onboarding**
   - clear first-run framing (what CrewCue is, who it is for)
   - smooth path from onboarding into auth
2. **DL2 - Normal login flow**
   - reliable Auth0 sign-in/sign-out and session restore behavior
   - production-like copy and visual treatment for auth screens/states
3. **DL3 - GPX import -> expected split times**
   - import a GPX file
   - compute/show expected split times in a clear readout
   - show actionable error states for invalid/unsupported GPX files
4. **DL4 - Crew creation + member invite**
   - create crew workflow
   - invite members workflow
   - role-aware visibility of member/invite status
5. **DL5 - Shared crew notes**
   - add notes to crew context
   - notes are visible to all crew members in-app
   - freshness/empty/error states are clear
6. **DL6 - Demo visual pass**
   - design-system consistency across demo-critical screens
   - remove shell/test phrasing and rough edge copy
   - tighten layout hierarchy so screens look customer-ready

Exit gate:

- A presenter can complete onboarding, login, GPX import with expected splits, crew creation/invite, and shared notes live in-app without needing race ping/checkpoint flows.
- Demo-critical screens look production-like and consistent with design-system baseline.

## Epic B - Demo hardening

**Goal:** reduce demo risk and make presentation resilient.

Sprints:

- scripted demo path with deterministic seed data + reset steps
- empty/loading/error polish for all Wave A surfaces
- staging smoke checklist dedicated to the demo narrative
- latency and reliability spot checks for demo actions

Exit gate:

- Demo can be repeated by another operator with predictable output and no ad-hoc setup.

## Backlog - not required for this demo (do not delete, keep tracked)

The items below remain valid roadmap work and should move forward after demo waves unless reprioritized again:

- Live race operations depth:
  - WS2 checkpoint/stoppage operator depth
  - ping-driven projection operation loops
- WS5 resilience depth:
  - outbox conflict/rejected recovery UX expansion beyond current baseline
  - queue diagnostics/merge telemetry hardening
- WS3/WS4 deeper race operations:
  - full incident-to-plan-update operational loop hardening
  - extended protocol/timeline/task operation depth
- Broader UX architecture hardening:
  - global navigation cleanup
  - larger accessibility/large-text and latency program across all surfaces
- WS6 manager command center:
  - multi-athlete board and overlap/conflict views (still deferred until post-demo priorities allow)

---

## 6) UI capability matrix by workstream

| Workstream | MVP UI requirement | First epic |
| --- | --- | --- |
| WS1 | role-aware room lifecycle UI + demo auth/onboarding continuity | Epic A |
| WS2 | projection + checkpoint stoppage controls | Backlog (post-demo) |
| WS3 | crew task execution + notes/timeline | Backlog (post-demo) |
| WS4 | incident capture + adaptive recommendation view | Backlog (post-demo) |
| WS5 | outbox/sync/conflict visibility and recovery | Backlog (post-demo) |
| WS6 | multi-athlete manager board | Backlog (deferred) |
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

This order is mandatory for active epics. WS6 starts only when explicitly pulled from the Backlog.

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

## 9) Required documentation updates per epic

Each merged epic or sprint should update:

1. this file (`ui-delivery-roadmap-and-spec.md`) revision history
2. relevant chunk doc(s) (Chunk C for shell changes, Chunk D stream doc for depth changes)
3. smoke/runbook docs if operator steps change

No "silent UI architecture changes" in PRs without doc updates.

---

## 10) PR acceptance checklist for UI work

A UI PR is not complete unless all apply:

- [ ] maps to a specific epic + sprint in this doc
- [ ] reuses existing API/outbox contracts or clearly refactors them
- [ ] includes offline/error/freshness behavior for modified workflows
- [ ] includes tests for new state/mutation behavior
- [ ] includes staging validation notes (manual or automated)
- [ ] updates docs where operator workflow changed

---

## 11) Revision history

| Date | Change |
| --- | --- |
| 2026-04-29 | Reframed roadmap to demo-first execution using **Epic / Sprint / Backlog** terminology; moved non-demo unfinished work into explicit backlog tracking without deleting scope. |
| 2026-04-28 | Clarified Phase 2 WS5 safe-retry scope as **pending ping only** in roadmap text to match current UI/sync behavior and guard against retry-path drift. |
| 2026-04-28 | Added guarded fallback design-system implementation under `apps/mobile/src/design-system` (tokens + DS wrappers) and switched mobile style generation to token-driven theming while canonical design artifacts are unavailable. |
| 2026-04-28 | Phase 1/2 UI hardening pass: operator-facing wording updates, explicit disable reasons for key controls, readouts incident return-path improvement, and shared navigation color tokenization. |
| 2026-04-27 | Documented Phase 2 incremental slice for targeted safe retry controls (issue #162) without adding a second retry queue. |
| 2026-04-27 | Phase 1: structured Operate tab sections (`phase1-part-a` / `phase1-part-b` on `OperationalSummarySections`) plus roadmap note. |
| 2026-04-27 | Phase 2: WS5 queue diagnostics + merge-record client routes; Status Detail panel; conflict merge telemetry action; shared projection/sync readout blocks to dedupe Operate vs Readouts. |
| 2026-04-24 | Initial publication: phased UI roadmap, architecture constraints, anti-duplication rules, and PR checklist. |
| 2026-04-24 | Reordered priorities so WS6 manager command center is deferred to Phase 5 (last priority) and added explicit monorepo-first execution order. |
| 2026-04-24 | Added dedicated Phase 3 staging validation checklist reference for WS3/WS4 mobile exit-gate verification. |
