# WS3 Execution Sequence (Sprint 1)

This sequence is the **first shippable ladder** for **crew orchestration**: turning aid-station intent into **tasks**, **assignments**, **shared protocol notes**, and a **crew-visible timeline**—without pretending the full offline or database story is solved yet.

**Sprint hub (GitHub):** [#23 — WS3 Sprint 1 tracking](https://github.com/collinbrowse/CrewCue/issues/23)  
**Milestone:** *WS3 Sprint 1 — crew orchestration*  
**Master plan (repo root):** [ws3-crew-orchestration-and-protocol-execution-plan.md](../../ws3-crew-orchestration-and-protocol-execution-plan.md)

## What WS3 adds (conceptually)

- **WS1** answered: *Who is in the room, and what can they see?*
- **WS2** answered: *Where is the athlete on the course, and what numbers should we show right now?*
- **WS3** answers: *What should crew **do** at the next checkpoint, **who** owns it, and what **protocol** and **history** does everyone share while doing it?*

So WS3 is mostly: **plan inputs → tasks → assignments → execution state → shared notes + ordered timeline** — with **role-scoped visibility** so the wrong person never sees the wrong task.

## Dependencies (and how Sprint 1 narrows scope)

| Dependency | What we rely on | Sprint 1 stance |
| --- | --- | --- |
| **WS1** | Race room membership and **roles** for authorization | **Required** — reuse existing patterns on new routes. |
| **WS7** | Canonical checkpoint / task / event **persistence** model | **Deferred for storage** until WS7 lands; Sprint 1 may use **in-memory or minimal** stores with shapes that can migrate. See [ws7-shared-platform-contracts-and-data-model-plan.md](../../ws7-shared-platform-contracts-and-data-model-plan.md). |
| **WS5** | Offline queues and merge semantics | **Not required** to close Sprint 1; APIs can be **online-first** with polling. |

---

## Task 1: Shared contracts for crew entities

**GitHub:** [#19](https://github.com/collinbrowse/CrewCue/issues/19)

### Objective

Give the API and future clients **one shared vocabulary** for WS3 entities before routes multiply.

### In-scope

- Types aligned to the master plan’s **data contracts** (minimal MVP fields): `CheckpointPlan`, `CrewTask`, `CrewAssignment`, `ProtocolNote`, `OpsTimelineEvent` (timeline type may stay thin until Task 4).
- Export from `packages/contracts` (or the package the repo already treats as canonical for API payloads).

### Out-of-scope (this task)

- Postgres tables and migrations (WS7).
- WS5 conflict-resolution payloads.

### Done when

- Types are merged and `npm run typecheck` is green.
- Issue **#19** closed via PR using `Closes #19` in the PR body.

**API notes:** add under `docs/api/` when the first HTTP surface ships (Task 2+); this task may land with types only.

---

## Task 2: Read task board (role-scoped)

**GitHub:** [#20](https://github.com/collinbrowse/CrewCue/issues/20)

### Objective

Authorized crew can **see** the right tasks for a race room: filtered by **role** and **checkpoint context**, without leaking tasks across roles.

### In-scope

- HTTP **read** endpoint(s) for a task board (paths and DTOs in the implementing PR).
- Authorization consistent with **WS1** room access (forbidden for non-members; no wrong-role visibility).
- In-memory or minimal persistence is acceptable for this sprint if behavior and checks are correct.

### Out-of-scope (this task)

- Optimistic concurrency UX.
- Push/WebSocket delivery (polling is fine).

### Done when

- Automated tests: happy path + at least one **forbidden** path.
- Manual note in PR: two JWT personas (allowed vs denied) if helpful for reviewers.
- Issue **#20** closed via linked PR.

---

## Task 3: Task assignment and lifecycle mutations

**GitHub:** [#21](https://github.com/collinbrowse/CrewCue/issues/21)

### Objective

A crew lead role can **assign** work and move tasks through a small **lifecycle** (e.g. assigned → in progress → completed) so the board matches checkpoint reality.

### In-scope

- Mutation endpoint(s) with **role checks** before state changes.
- Clear **4xx** errors on illegal transitions; no silent corruption.
- Enough internal events or state to support a **timeline read model** in Task 4.

### Out-of-scope (this task)

- Autoscheduling / optimization.
- Full offline command queue (WS5).

### Done when

- Tests: one happy path + one forbidden mutation.
- Issue **#21** closed via linked PR.

---

## Task 4: Protocol notes and minimal ops timeline

**GitHub:** [#22](https://github.com/collinbrowse/CrewCue/issues/22)

### Objective

**Protocol** content (heat, nutrition, blister, etc.) is easy to **read and update** in the right checkpoint context, and a **minimal timeline** shows ordered crew actions.

### In-scope

- Read/write or append-only API for protocol notes (exact semantics in PR).
- Timeline read model: ordered events (e.g. from task completions and optional notes).

### Out-of-scope (this task)

- Rich editor, attachments, full-text search.
- Full merge-review product flow for conflicts (server should still avoid silent loss).

### Done when

- Tests or documented manual checks cover protocol read and timeline ordering after mutations.
- Issue **#22** closed via linked PR.

---

## Order rationale

1. **Contracts first** — keeps HTTP handlers thin and tests stable.
2. **Read board second** — proves **authorization** and “what crew sees” before writes complicate state.
3. **Mutations third** — lifecycle without protocol/timeline noise first.
4. **Protocol + timeline last** — builds on stable tasks and events.

## Done definition for WS3 Sprint 1

- Tasks **#19–#22** each merged with green CI, each PR explicitly **`Closes #…`** for its issue ([workflow](./github-issues-and-prs.md)).
- **#18** (this doc) merged via its own PR.
- Sprint hub **#23** checklist updated (or closed when all children are done and you accept the sprint outcome).
- Master plan file [ws3-crew-orchestration-and-protocol-execution-plan.md](../../ws3-crew-orchestration-and-protocol-execution-plan.md) remains the north star; this doc is the **execution ladder** for Sprint 1 only.
