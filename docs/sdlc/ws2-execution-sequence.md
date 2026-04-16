# WS2 Execution Sequence (First Sprint)

This sequence turns the **WS1 race room** into something that can carry **live race intelligence**: location pings in, structured projections out. It deliberately stays smaller than the full vision in `ws2-live-split-intelligence-engine-plan.md` (weather, deep history, hardware integrations) until later slices.

## What WS2 adds (conceptually)

- **WS1** answered: *Who is in the room, and is this room allowed to run?*
- **WS2** answers: *Given where the athlete is (or was) along the course, what splits and ETA-style numbers should everyone see right now?*

So WS2 is mostly: **ingest → validate → recompute → expose read models** — with clear behavior when data is bad or late.

---

## Task 1: Ping ingest and validation

### Objective

Let clients send **athlete location pings** for an active race room. The server **accepts or rejects** each ping with explicit rules so bad data cannot silently corrupt downstream state.

### In-scope

- Contract types for a ping payload (e.g. coordinates, timestamp, optional accuracy).
- `POST` endpoint scoped to a `roomId` (members + entitlement rules aligned with WS1 patterns where reads/writes matter).
- Validation outcomes: **accepted** vs **rejected** (invalid payload, clock too skewed, impossible jump, room not active, etc.) — exact rules documented in code and API notes.
- Append-only **decision record** in process memory or structured logs for this slice (persistence can follow).

### Out-of-scope (this task)

- Full **event-sourced** store across restarts (defer to a follow-on once shapes stabilize).
- WS5 offline merge semantics.

### Done when

- Automated tests cover happy path + primary rejection reasons.
- Short API note under `docs/api/` describes request/response and status codes.

**Reference:** [docs/api/ws2-task1-pings.md](../api/ws2-task1-pings.md) (implemented on `raceRooms` routes: `POST .../pings`, `GET .../pings/history`).

---

## Task 2: Deterministic split and ETA projection

### Objective

On every **accepted** ping, recompute a **projection**: checkpoint splits, gap vs a simple plan, and an ETA-style estimate using a **deterministic** model (same inputs → same outputs). That makes tests and operator trust possible.

### In-scope

- Minimal **course model** for the slice (e.g. ordered checkpoints with distances or cumulative distances — versioned in contracts or config).
- A **baseline plan** stub (fixed pace or supplied at room activation) so “delta vs plan” is meaningful in tests.
- Recompute pipeline: `PingAccepted` → `SplitRecomputed` / `ProjectionPublished` as domain events or internal steps (align naming with `ws2-live-split-intelligence-engine-plan.md`).
- In-memory **latest projection** per room.

### Out-of-scope (this task)

- Weather feeds, rich athlete history, and sport-specific tuning (called out in the master WS2 plan as later work).

### Done when

- Golden tests: fixture pings → expected splits/ETA/delta within fixed tolerances.
- Logging or audit-friendly lines for recompute decisions (volume-aware, not noisy secrets).

**Reference:** [docs/api/ws2-task2-projection.md](../api/ws2-task2-projection.md) — activation `course` / `plannedPaceSecondsPerKm`, projection on accepted ping, `GET .../projection`, `projection_recompute` logs.

---

## Task 3: Projection read API and staleness

### Objective

Clients and later workspaces (WS3 tasks, WS4 incidents, WS6 command center) need a **stable read** of “current projection” plus a sense of **confidence** when the feed goes stale.

### In-scope

- `GET` (or equivalent) **latest projection** for a room, with membership + entitlement checks consistent with WS1.
- **Staleness / degraded confidence** when no acceptable ping has arrived within a configurable window (server-side threshold).
- Explicit JSON fields consumers can bind to (numbers + flags + `asOf` timestamp).

### Out-of-scope (this task)

- Push/WebSocket delivery (can be WS2b or WS5-aligned); this task is HTTP pull first.

### Done when

- Tests for: fresh projection, degraded after silence, forbidden for non-members.
- Manual smoke doc: mint JWT → send pings → read projection → observe degraded state after stopping pings.

---

## Done definition for this WS2 sprint

- All three tasks merged with green CI.
- Contracts in `@crewcue/contracts` extended only as far as this slice requires.
- Master plan file `ws2-live-split-intelligence-engine-plan.md` remains the north star; this execution doc is the **first shippable ladder** up that hill.

## Order rationale

1. **Ingest + validation** first — without trustworthy inputs, projections are fiction.
2. **Deterministic recompute** second — proves the core value and makes regressions obvious.
3. **Read API + staleness** third — turns internal state into something product surfaces can rely on.
