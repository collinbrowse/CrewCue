# CrewCue MVP UI development spec (implementation-ready)

**Audience:** product engineers, operators, and AI coding agents building CrewCue UI.  
**Purpose:** provide a single specification that converts existing backend/platform delivery into a complete, focused MVP UI build plan.

**Standards alignment:**

- [README.md](./README.md)
- [ui-delivery-roadmap-and-spec.md](./ui-delivery-roadmap-and-spec.md)
- [agent-handoff.md](./agent-handoff.md)
- [codebase-maintainability-standard.md](./codebase-maintainability-standard.md)
- [dual-client-architecture-guardrails.md](./dual-client-architecture-guardrails.md)
- `CrewCue Design/design-system-kit/design-system/DESIGN_SYSTEM_INSTRUCTIONS.md`
- `CrewCue Design/design-system-kit/design-system/design-system.json`

---

## 1) Scope and outcome (demo priority)

Current priority is a customer-facing **demo build** delivered as fast as possible while preserving clean architecture.

The demo UI must clearly show what CrewCue does through these workflows:

1. onboarding experience
2. normal login flow (Auth0)
3. GPX import with expected split-time output
4. crew creation and member invites
5. shared crew notes visible across members

Demo readiness is complete when these workflows are reliable, role-aware where applicable, and visually polished enough for customer demos on staging.

Non-demo flows remain in the backlog (Backlog section in roadmap) and are not deleted.

---

## 2) Baseline audit: what is already implemented

### 2.1 Implemented foundation (confirmed in code)

- Auth0 mobile authentication and guest/authenticated nav split are live.
- Operate + Readouts top-level tab structure is live.
- API transport layer already covers WS1-WS7 endpoints required by MVP workflows.
- Outbox queue, batch processor, and retry/conflict/rejected states are implemented.
- Role guards for checkpoint/task/merge telemetry controls are implemented.
- WS5 telemetry surfaces (sync diagnostics + merge records) are implemented.
- WS3/WS4 operational readouts (task board, timeline, incidents, recommendation, plan delta) are implemented.

### 2.2 Current UX quality level

- Functional, operator-oriented shell is implemented.
- Information architecture is present but still shell-like in interaction language and visual hierarchy.
- Primary gap is UI productization: clearer workflow affordances, reduced cognitive load, and design-system-level consistency.

### 2.3 Demo delta to complete

- tighten IA and microcopy around onboarding/auth/demo narrative
- harden screen-level states and transitions for demo-critical paths
- remove shell/testing phrasing from user-facing controls
- add deterministic validation checklist by demo flow and role
- map design file components/tokens to implementation modules

---

## 3) Product information architecture (demo build)

## Top-level navigation

- `Operate` (default): execute actions + monitor immediate operational status
- `Readouts`: consume deeper operational context (projection, tasks, incidents, recommendations)

## Operate stack

- `OperateHome`: primary control surface
- `OperateStatus`: focused sync/status/telemetry detail
- `OperateOutbox`: focused queue/conflict/retry detail

## Readouts stack

- `ReadoutsHome`: full operational readout composition
- `ReadoutsIncidents`: incident feed detail

No additional top-level tabs are required for the demo.

---

## 4) Role model and visibility rules

Authoritative permissioning is server-side; UI only controls rendering and affordance gating.

- `athlete`: can participate in room context and telemetry visibility; no crew-only mutation controls
- `crew_member` / `crew_chief` / `team_manager`:
  - checkpoint stoppage controls enabled when room active + projection present
  - task mutation actions enabled by task state and role access
- merge telemetry action is visible only to roles allowed by existing guard logic

UI must always show *why* a control is disabled (room status, missing projection, insufficient role, busy state).

---

## 5) Screen-by-screen MVP specification

## 5.1 `OperateHome`

### Purpose

Single workflow hub for room lifecycle, checkpoint operations, outbox processing, and high-signal status.

### Required sections (top to bottom)

1. Session header
2. Status rail
3. Room summary
4. Projection summary (with stoppage + split controls)
5. Checkpoints and room actions
6. Outbox queue summary
7. Sync/timeline summary

### Required interactions

- create room
- pay entitlement
- activate room
- ping + sync heartbeat
- projection fetch + optional auto-refresh toggle
- task board fetch and mutations
- incident post/fetch + recommendation generate/accept/reject
- checkpoint enter/exit manual stop queueing
- projection visit source override
- process all pending outbox

### Required state handling

- loading/busy disabled state for action cluster
- explicit empty state text for absent room/projection/timeline/incidents/tasks
- inline outcome messaging for success/error/recovery hints

## 5.2 `OperateStatus`

### Purpose

High-confidence operational health view for at-a-glance triage.

### Required content

- session metadata
- status rail (pending count, latest status, latest error, projection freshness)
- WS5 telemetry panel:
  - refresh telemetry
  - push queue diagnostics snapshot
  - recent diagnostics rows
  - recent merge record rows

### Required guardrails

- disable telemetry actions when room missing or inactive
- explain disable reason in-line

## 5.3 `OperateOutbox`

### Purpose

Dedicated queue operations view for pending/rejected/conflict handling.

### Required content

- queue status counts (pending/sent/rejected/conflict)
- per-item operation details
- attempts + feedback + operator recovery hints
- targeted safe retry action where operation type allows
- optional merge telemetry logging action for conflicts

### Required semantics

- never show "synced" if pending/conflict/rejected exists
- recovery hints must differ for conflict vs rejected vs retrying pending

## 5.4 `ReadoutsHome`

### Purpose

Read-focused depth view for projection, tasks, timeline, incidents, and recommendation context.

### Required content

- room + ping context
- sync health block
- projection endpoint + stoppage summary + split list
- protocol notes summary
- timeline events
- incidents snapshot
- recommendation + explainability + plan delta snapshot
- task board with state-based action affordances

## 5.5 `ReadoutsIncidents`

### Purpose

Incident-centered drilldown for WS4 operational review.

### MVP requirement

- chronological incident feed, with severity and category prominence
- easy return path to recommendation actions on `ReadoutsHome`

---

## 6) Demo flows and acceptance criteria

## 6.1 Onboarding + login flow

**Path:** first app open -> onboarding -> Auth0 login -> authenticated landing  
**Acceptance:**

- first-run value proposition is clear in onboarding
- user can sign in and return to an authenticated session without manual resets
- failure responses are actionable and non-technical

## 6.2 GPX import -> expected split times flow

**Path:** open import -> select GPX -> parse/process -> render expected split times  
**Acceptance:**

- valid GPX imports produce expected split-time output in-app
- invalid/unsupported files show clear guidance
- loading and completion states are obvious to presenter/operator

## 6.3 Crew creation + invites flow

**Path:** create crew -> invite one or more members -> view invite/member state  
**Acceptance:**

- crew can be created end-to-end in-app
- invite actions provide immediate feedback and state visibility
- role/permission constraints are explained when an action is unavailable

## 6.4 Shared crew notes flow

**Path:** add note in crew context -> refresh or observe update -> other member sees same note  
**Acceptance:**

- notes post successfully with visible confirmation
- notes are visible to invited crew members
- empty/error states are clear and recoverable

## 6.5 Demo visual polish flow

**Path:** navigate through all demo-critical screens  
**Acceptance:**

- consistent DS components/tokens on demo-critical surfaces
- no smoke/test wording in primary user actions
- hierarchy and spacing look customer-ready in light and dark themes

---

## 7) State, data, and module boundaries (must follow)

Required layering:

1. server API state (authoritative)
2. local derived presentation state
3. outbox mutation intent state
4. ephemeral input/toggle state

Implementation constraints:

- no duplicate network paths outside `apps/mobile/src/api/client.ts`
- no duplicate outbox execution paths outside `apps/mobile/src/sync/`*
- shared readout/composition logic belongs in `apps/mobile/src/components/*` or `apps/mobile/src/features/*`
- `App.tsx` remains orchestration and provider assembly, not screen-specific business logic

---

## 8) UI content and interaction standards for MVP

Use operator language, not backend/testing language, in end-user labels.

- replace smoke/test-centric CTA wording in user-facing screens
- preserve technical detail in secondary metadata lines, not primary CTA labels
- pair every disabled control with a reason text
- represent freshness, pending, rejected, and conflict using consistent semantic styling
- prefer short, unambiguous action verbs (`Activate room`, `Process queue`, `Generate recommendation`)

---

## 9) Design system baseline (active)

The design system source of truth for MVP UI starts with:

- `CrewCue Design/design-system-kit/design-system/DESIGN_SYSTEM_INSTRUCTIONS.md`
- `CrewCue Design/design-system-kit/design-system/design-system.json`

These files are now the mandatory baseline for UI implementation and refactors.

### 9.1 Non-negotiable implementation rules

- use `DSButton`, `DSCard`, and `DSTextInput` for interactive controls and containers
- do not hardcode color hex values in feature screens
- do not create one-off visual variants outside `design-system.json`
- all UI changes must support light and dark themes

### 9.2 Preset selection contract

- CTA actions -> `button.primary`
- neutral actions -> `button.secondary`
- destructive actions -> `button.danger`
- content containers -> `card.base`
- editable fields -> `textInput.base`

### 9.3 Token usage contract

When an existing preset does not fully fit:

1. keep layout/behavior unchanged
2. apply `useDSTheme()` token values for minimal overrides
3. if repeated usage appears, add a semantic preset to `design-system.json` before broad rollout

### 9.4 Migration order (must follow)

1. migrate shared primitives (`Button`, `Input`, `Card`) to DS wrappers
2. replace text/background/border colors with theme tokens
3. remove conflicting duplicate inline visual styles
4. validate each migrated screen in light and dark mode

### 9.5 MVP enforcement checks

- no `hardcodedHex` visual tokens in feature screens
- no inline-style colors/spacings where DS presets already cover intent
- no unapproved variants
- preserve existing operational layout and action behavior during visual migration

---

## 10) Design file integration requirements

This section is mandatory when design assets are provided.

For each screen, record:

- design frame/screen id
- mapped implementation route/component
- token mapping (color, spacing, typography)
- interaction parity notes (exact, acceptable variant, deferred)
- accessibility checks (contrast, touch target, dynamic text)

Use this table during implementation:


| UI surface        | Design reference | Implementation target                            | Parity status        | Notes                                                                        |
| ----------------- | ---------------- | ------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------- |
| OperateHome       | TBD              | `src/navigation/AuthenticatedOperateScreen.tsx`  | interaction-hardened | copy/guardrail pass complete; waiting on design frame ids + DS token mapping |
| OperateStatus     | TBD              | `src/navigation/OperateStatusScreen.tsx`         | interaction-hardened | telemetry disable reasons and wording aligned; waiting on design handoff     |
| OperateOutbox     | TBD              | `src/navigation/OperateOutboxScreen.tsx`         | interaction-hardened | queue semantics and hints aligned; waiting on design handoff                 |
| ReadoutsHome      | TBD              | `src/navigation/AuthenticatedReadoutsScreen.tsx` | interaction-hardened | readout language tightened; waiting on design handoff                        |
| ReadoutsIncidents | TBD              | `src/navigation/ReadoutsIncidentsScreen.tsx`     | interaction-hardened | incident drilldown + return path added; waiting on design handoff            |


### 10.1 Human intervention required before DS parity pass

- Design frame ids are still required to complete this section's reference mapping.
- Official design source files (`DESIGN_SYSTEM_INSTRUCTIONS.md`, `design-system.json`) were unavailable in-repo, so implementation used a guarded fallback DS baseline in `apps/mobile/src/design-system/*` with tokenized light/dark themes and wrappers (`DSButton`/`DSCard`/`DSTextInput`).
- When official assets become available, map fallback tokens/presets to canonical tokens and run a parity audit before claiming full design parity.

---

## 11) Demo implementation sequence (UI-focused)

1. **Freeze demo contracts/routes:** no speculative UI-only behavior for non-demo flows.
2. **Demo interaction hardening:** enforce state gating and empty/error/freshness states for onboarding, login, GPX import, crew/invites, and notes.
3. **Demo IA and wording pass:** remove shell/testing language and align with customer demo narrative.
4. **Design parity pass:** map design tokens/components to demo-critical screen modules first.
5. **Demo validation pass:** run end-to-end manual checks for all section 6 demo flows on staging.
6. **Documentation pass:** update this spec + roadmap doc with demo status and Backlog deltas.
7. **Design system compliance pass:** verify DS wrapper usage and forbidden-token checks before merge.

---

## 12) Validation checklist (demo definition of done)

- All demo flows in section 6 are executable in app on staging
- Role gating and disabled-reason copy verified where mutations exist
- No duplicate API or outbox logic introduced
- UI labels are customer-facing (no smoke/test phrasing in primary controls)
- Manual validation evidence documented for each demo flow
- Design mapping table completed with frame references and parity notes for demo-critical surfaces
- DS primitives (`DSButton`/`DSCard`/`DSTextInput`) are used where applicable
- Light/dark theme parity verified for all demo-critical screens
- PR body includes decision rationale, assumptions, and higher-order effects sections (required by template/CI)

---

## 13) Deliverables expected from demo completion

- demo-ready mobile workflow surfaces for onboarding, login, GPX import/splits, crew/invites, and shared notes
- documented design-to-implementation mapping for all demo-critical screens
- explicit Backlog carry-forward plan for remaining WS2/WS3/WS4/WS5/WS6 scope

---

## 14) Revision history


| Date       | Change                                                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-29 | Integrated PR decision-rationale workflow into demo spec validation (template + `pr-decision-doc-guard` CI gate).                                                                                                                         |
| 2026-04-29 | Re-scoped spec to demo-first execution (onboarding, login, GPX import/splits, crew/invites, shared notes), preserving architecture/quality guardrails and moving non-demo scope to Backlog tracking.                                      |
| 2026-04-28 | Added fallback in-repo design-system baseline (`apps/mobile/src/design-system`) to continue migration safely without external design assets; migrated key navigation surfaces to DS wrappers and tokenized style generation in `App.tsx`. |
| 2026-04-28 | Interaction hardening + operator copy pass implemented across mobile MVP screens/components; added explicit human-unblock notes for missing design-system artifacts and frame references.                                                 |
| 2026-04-28 | Adopted design system baseline from provided instructions + JSON token schema; added mandatory DS rules, migration order, and compliance criteria for MVP UI work.                                                                        |
| 2026-04-28 | Initial publication: implementation-ready MVP UI development spec based on current mobile/navigation/API/outbox baseline with full screen/flow acceptance criteria and design integration contract.                                       |


