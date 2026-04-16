# WS3 Sprint 1 — sign-off

**Status:** Complete (first **crew orchestration** slice on the API: tasks, assignments, protocol notes, and a shared timeline — still **in-memory**, suitable for integration demos and the next persistence pass).

**Tracking:** GitHub milestone *WS3 Sprint 1 — crew orchestration*; sprint hub [#23](https://github.com/collinbrowse/CrewCue/issues/23) (closed).

## What shipped

- **#18 — Execution ladder:** [ws3-execution-sequence.md](./ws3-execution-sequence.md) (task order, dependencies, done definition).
- **#19 — Contracts:** `CheckpointPlan`, `CrewTask`, `CrewAssignment`, `ProtocolNote`, `OpsTimelineEvent` in `@crewcue/contracts` ([packages/contracts](https://github.com/collinbrowse/CrewCue/tree/main/packages/contracts)).
- **#20 — Task board read:** `GET /race-rooms/:roomId/tasks` (membership + entitlement; role-scoped visibility; optional `checkpointId` filter) — merged via [#26](https://github.com/collinbrowse/CrewCue/pull/26).
- **#21 — Task lifecycle:** `POST .../tasks/:taskId/assign|start|complete` with role checks, clear **4xx** on bad transitions, timeline events for assign/start/complete — merged via [#27](https://github.com/collinbrowse/CrewCue/pull/27).
- **#22 — Protocol + timeline read:** `GET/POST /race-rooms/:roomId/protocol-notes`, `GET /race-rooms/:roomId/timeline` — merged via [#28](https://github.com/collinbrowse/CrewCue/pull/28).

## Still in-memory (by design for this sprint)

Task boards, protocol notes, and timeline events **reset when the API process restarts**. **WS7** owns durable schema and storage; **WS5** owns offline merge when you need it. Shapes in contracts are the bridge to both.

## Optional manual smoke

1. Paid, **active** room with course (same setup as existing race room tests).
2. `GET .../tasks` as **crew_chief** vs **crew_member** and confirm role-scoped tasks.
3. `POST .../assign` → `start` → `complete` as allowed roles; expect **409** on illegal jumps.
4. `POST .../protocol-notes` then `GET .../protocol-notes` and `GET .../timeline` and confirm ordering.

## Suggested next step

Pick the next slice in roadmap order (for example **WS4** incidents / adaptive plan loop) **or** deepen WS3 with **persistence + real auth** when you start **WS7** — whichever unblocks your next demo or pilot.
