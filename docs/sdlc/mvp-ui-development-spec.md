# CrewCue MVP UI development spec (implementation-ready)

**Audience:** product engineers, operators, and AI coding agents building CrewCue UI.  
**Purpose:** provide a single specification that converts existing backend/platform delivery into a complete, focused MVP UI build plan.

**Standards alignment:**
- [README.md](./README.md)
- [ui-delivery-roadmap-and-spec.md](./ui-delivery-roadmap-and-spec.md)
- [agent-handoff.md](./agent-handoff.md)
- [codebase-maintainability-standard.md](./codebase-maintainability-standard.md)
- [dual-client-architecture-guardrails.md](./dual-client-architecture-guardrails.md)
- [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md)
- `CrewCue Design/design-system-kit/design-system/DESIGN_SYSTEM_INSTRUCTIONS.md`
- `CrewCue Design/design-system-kit/design-system/design-system.json`

---

## 1) Scope and outcome

The MVP UI must let a team run core race-day operations from the app without backend-side manual intervention:

1. authenticate and enter an operational session
2. create/activate a race room
3. execute checkpoint and stoppage operations
4. monitor projection/sync status and queue health
5. execute task board actions
6. record incidents and process adaptive recommendations
7. recover from expected offline/conflict/rejected paths

MVP is complete when these workflows are reliable, role-aware, and operator-comprehensible on staging.

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

### 2.3 MVP delta to complete

- tighten IA and microcopy around operator mental model
- harden screen-level states and transitions
- remove shell/testing phrasing from user-facing controls
- add deterministic validation checklist by flow and role
- map design file components/tokens to implementation modules

---

## 3) Product information architecture (MVP)

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

No additional top-level tabs are required for MVP.

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

## 6) Core user flows and acceptance criteria

## 6.1 Room lifecycle flow (WS1)

**Path:** authenticate -> create room -> entitlement paid -> activate room  
**Acceptance:**
- user can complete flow without leaving app
- role and permission context visible after room fetch
- failure responses surfaced with actionable text

## 6.2 Projection/stoppage flow (WS2)

**Path:** active room -> ping -> projection -> station enter -> station exit/manual stop queue -> outbox process -> refreshed projection  
**Acceptance:**
- queue intent appears immediately
- processed state visible after flush
- stoppage readout updates from authoritative projection

## 6.3 Resilience/recovery flow (WS5)

**Path:** pending/conflict/rejected queue item -> operator reads hint -> retry or corrective action -> process queue -> health recheck  
**Acceptance:**
- conflict and rejected are visually distinct
- operators can complete at least one successful recovery path in-app
- telemetry rows can be refreshed and inspected

## 6.4 Task flow (WS3)

**Path:** fetch task board -> assign/start/complete -> queue process -> task status updated  
**Acceptance:**
- action availability strictly follows task status + role guard
- queued actions include immediate user feedback

## 6.5 Incident/adaptive flow (WS4)

**Path:** post incident -> fetch incidents -> generate recommendation -> accept/reject -> inspect plan delta  
**Acceptance:**
- recommendation status change clearly shown
- explainability factors displayed when present
- accepted recommendation can produce visible plan delta

---

## 7) State, data, and module boundaries (must follow)

Required layering:

1. server API state (authoritative)
2. local derived presentation state
3. outbox mutation intent state
4. ephemeral input/toggle state

Implementation constraints:

- no duplicate network paths outside `apps/mobile/src/api/client.ts`
- no duplicate outbox execution paths outside `apps/mobile/src/sync/*`
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

| UI surface | Design reference | Implementation target | Parity status | Notes |
| --- | --- | --- | --- | --- |
| OperateHome | TBD | `src/navigation/AuthenticatedOperateScreen.tsx` | interaction-hardened | copy/guardrail pass complete; waiting on design frame ids + DS token mapping |
| OperateStatus | TBD | `src/navigation/OperateStatusScreen.tsx` | interaction-hardened | telemetry disable reasons and wording aligned; waiting on design handoff |
| OperateOutbox | TBD | `src/navigation/OperateOutboxScreen.tsx` | interaction-hardened | queue semantics and hints aligned; waiting on design handoff |
| ReadoutsHome | TBD | `src/navigation/AuthenticatedReadoutsScreen.tsx` | interaction-hardened | readout language tightened; waiting on design handoff |
| ReadoutsIncidents | TBD | `src/navigation/ReadoutsIncidentsScreen.tsx` | interaction-hardened | incident drilldown + return path added; waiting on design handoff |

### 10.1 Human intervention required before DS parity pass

- Design frame ids are still required to complete this section's reference mapping.
- Official design source files (`DESIGN_SYSTEM_INSTRUCTIONS.md`, `design-system.json`) were unavailable in-repo, so implementation used a guarded fallback DS baseline in `apps/mobile/src/design-system/*` with tokenized light/dark themes and wrappers (`DSButton`/`DSCard`/`DSTextInput`).
- When official assets become available, map fallback tokens/presets to canonical tokens and run a parity audit before claiming full design parity.

---

## 11) MVP implementation sequence (UI-focused)

1. **Freeze baseline contracts/routes:** no speculative UI-only behavior.
2. **Interaction hardening pass:** enforce state gating and empty/error/freshness states across all existing screens.
3. **IA and wording pass:** convert shell/testing labels into operator language.
4. **Design parity pass:** map design tokens/components to current screen modules.
5. **Flow validation pass:** run end-to-end role-based manual checks on staging.
6. **Documentation pass:** update this spec + roadmap doc with completion status.
7. **Design system compliance pass:** verify DS wrapper usage and forbidden-token checks before merge.

---

## 12) Validation checklist (definition of done)

- [ ] All MVP flows in section 6 are executable in app on staging
- [ ] Role gating and disabled-reason copy verified for all mutating controls
- [ ] Outbox states (pending/sent/rejected/conflict) are distinct and recoverable
- [ ] No duplicate API or outbox logic introduced
- [ ] UI labels are operator-facing (no smoke/test phrasing in primary controls)
- [ ] Manual validation evidence documented for each flow
- [ ] Design mapping table completed with frame references and parity notes
- [ ] DS primitives (`DSButton`/`DSCard`/`DSTextInput`) are used where applicable
- [ ] Light/dark theme parity verified for all touched screens

---

## 13) Deliverables expected from UI MVP completion

- production-ready mobile MVP workflow surfaces for WS1-WS5 + WS3/WS4 depth
- documented design-to-implementation mapping for all MVP screens
- stable base for deferred WS6 manager command center and eventual `apps/web`

---

## 14) Revision history

| Date | Change |
| --- | --- |
| 2026-04-28 | Added fallback in-repo design-system baseline (`apps/mobile/src/design-system`) to continue migration safely without external design assets; migrated key navigation surfaces to DS wrappers and tokenized style generation in `App.tsx`. |
| 2026-04-28 | Interaction hardening + operator copy pass implemented across mobile MVP screens/components; added explicit human-unblock notes for missing design-system artifacts and frame references. |
| 2026-04-28 | Adopted design system baseline from provided instructions + JSON token schema; added mandatory DS rules, migration order, and compliance criteria for MVP UI work. |
| 2026-04-28 | Initial publication: implementation-ready MVP UI development spec based on current mobile/navigation/API/outbox baseline with full screen/flow acceptance criteria and design integration contract. |
