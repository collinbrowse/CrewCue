# WS4 Execution Sequence (Sprint 1)

**Sprint status: complete** — see [ws4-sprint-signoff.md](./ws4-sprint-signoff.md).

This sequence is the **first ladder** for **structured incidents and an adaptive plan loop**: crew logs **typed incidents**, the system proposes a **reviewable recommendation** with rationale, humans **accept or reject**, and **plan versions** (with readable deltas) give everyone a shared history.

**Sprint hub (GitHub):** [#35 — WS4 Sprint 1 tracking](https://github.com/collinbrowse/CrewCue/issues/35)  
**Milestone:** *WS4 Sprint 1 — incidents and adaptive plan*  
**Master plan (repo root):** [ws4-structured-incidents-and-adaptive-plan-loop-plan.md](../../ws4-structured-incidents-and-adaptive-plan-loop-plan.md)

## What WS4 adds (conceptually)

- **WS2** answers: *Where is the athlete and what numbers do we show?*
- **WS3** answers: *What tasks does crew execute at the next stop?*
- **WS4** answers: *When reality diverges from the plan, what happened, what should we change next, who approved it, and what is the new official plan version?*

So WS4 is: **incident → recommendation → human decision → versioned plan update + explainability** — without autonomous closed loops in Sprint 1.

## Dependencies (and how Sprint 1 narrows scope)

| Dependency | What we rely on | Sprint 1 stance |
| --- | --- | --- |
| **WS1 / WS2** | Race room membership, entitlement, **active** room | **Required** — same patterns as existing race room routes. |
| **WS7** | Durable `PlanVersion` / audit storage | **Deferred** — in-memory stores with stable contract shapes. |
| **WS5** | Reliable fan-out of plan updates | **Not required** to close Sprint 1; HTTP read models are enough. |
| **WS0 AI** | Governed model calls | **Deferred** — deterministic / rule-based recommendation **stub** first. |

---

## Task 1: Shared contracts for incidents and plan versioning

**GitHub:** [#31](https://github.com/collinbrowse/CrewCue/issues/31)

### Objective

Shared **TypeScript contracts** for `IncidentEvent`, `Recommendation`, `PlanVersion`, `PlanDelta`, and a minimal `ExplainabilityRecord` so API and future clients stay aligned.

### Done when

- Types exported from `packages/contracts`.
- `npm run typecheck` is green across workspaces that consume them.

---

## Task 2: Structured incident submit and list

**GitHub:** [#32](https://github.com/collinbrowse/CrewCue/issues/32)

### Objective

Authorized, **paid** members of an **active** room can **submit** structured incidents and **list** incidents for operational review.

### Done when

- `POST` + `GET` endpoints are documented in code and covered by API tests (happy path + forbidden non-member).

---

## Task 3: Deterministic recommendation + accept / reject

**GitHub:** [#33](https://github.com/collinbrowse/CrewCue/issues/33)

### Objective

Each incident can produce at most one **pending** recommendation at a time (Sprint 1: deterministic stub). **Crew chief / team manager / athlete** can **accept** or **reject**; transitions return clear **4xx** when illegal.

### Done when

- Tests cover generate → accept and generate → reject.
- Accepting attaches rationale to a new **plan version** (see Task 4).

---

## Task 4: Plan version history and delta read model

**GitHub:** [#34](https://github.com/collinbrowse/CrewCue/issues/34)

### Objective

Expose **ordered plan versions** and a simple **delta** between two numeric versions for crew/athlete UIs.

### Done when

- `GET` plan versions returns monotonic ordering after accepts.
- `GET` plan delta returns stable summaries for the same `(fromVersion, toVersion)` pair.

---

## Order rationale

1. **Contracts** — keeps handlers and tests honest before HTTP surface grows.
2. **Incidents** — creates the feed recommendations consume.
3. **Recommendations + decisions** — proves the human-in-the-loop gate.
4. **Plan versions + deltas** — makes “what changed?” inspectable.

## Done definition for WS4 Sprint 1

- Issues **#30–#34** closed via PRs using **`Closes #…`** in PR bodies ([workflow](./github-issues-and-prs.md)).
- Sprint hub **#35** reflects completion.
- Master plan [ws4-structured-incidents-and-adaptive-plan-loop-plan.md](../../ws4-structured-incidents-and-adaptive-plan-loop-plan.md) remains the north star; this doc is the **Sprint 1 ladder** only.
