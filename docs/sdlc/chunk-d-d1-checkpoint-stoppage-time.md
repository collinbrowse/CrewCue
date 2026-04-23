# Chunk D1 / WS2 — Checkpoint stoppage time

**Audience:** engineers implementing WS2 projection depth and operators interpreting crew-facing stop metrics.  
**Staging validation:** [chunk-d-d1-stoppage-time-staging-smoke.md](./chunk-d-d1-stoppage-time-staging-smoke.md)  
**Related:** [chunk-d-d1-ws2-projection.md](./chunk-d-d1-ws2-projection.md) · [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md)

---

## 1. Motivation

WS2 splits already expose **when** a checkpoint was crossed, but ultra and cycling races are often won or lost on **aid station time** (moving vs stopped time). Crews need:

- planned stop budgets vs actual stop time (per checkpoint and in aggregate)
- a live signal when an athlete is inside an aid zone but not making forward progress
- a credible mitigation when GPS is coarse or connectivity is poor (manual crew timing)

---

## 2. Product concepts (operator language)

| Term | Meaning |
| --- | --- |
| **Planned stop** | Seconds the crew/athlete planned to spend slowed/stopped at this checkpoint (`plannedStopSeconds`, `0` = fly-through). |
| **Stoppage radius** | Meters around the checkpoint coordinate where slowdown detection runs (`stoppageRadiusMeters`, default `150`). |
| **Rolling moving speed** | Recent pace estimated from pings **outside** all stoppage radii; used as the reference for “slowed/stopped” inside radii. |
| **Slowdown threshold** | `rollingSpeed × slowdownThresholdRatio` (default ratio `0.5`). |
| **Slowed interval** | A consecutive ping pair **inside** the radius whose implied speed is below the threshold. |
| **Visit** | One pass through a checkpoint zone; re-entries create additional visits. |
| **Manual crew timing** | Enter/exit timestamps captured by crew when GPS is unusable. |
| **Resolved source** | Whether metrics use `auto` ping-derived timing or `manual_crew` timing when both exist. |

---

## 3. Contract surface (authoritative types)

The canonical TypeScript contracts live in `@crewcue/contracts` (`packages/contracts/src/index.ts`). The WS2 projection core includes:

- `RaceCourseCheckpoint` optional fields: `plannedStopSeconds?`, `stoppageRadiusMeters?`, `slowdownThresholdRatio?`
- `RaceCheckpointSplitRow` stoppage fields: `plannedStopSeconds`, `visits[]`, `totalActualStopSeconds`, `deltaStopSeconds`
- `RaceRoomProjectionCore.stoppageSummary` aggregate rollup

---

## 4. Server-side detection model (summary)

Stoppage detection runs during `recomputeRaceProjection` while replaying accepted pings in `recordedAt` order.

### Rolling speed

When the athlete is **outside every** checkpoint stoppage radius, update a smoothed moving speed estimate from consecutive ping pairs (EMA \(\alpha = 0.3\)). Until enough out-of-radius samples exist, fall back to plan pace (`1000 / plannedPaceSecondsPerKm`).

### Visit lifecycle + slowed accumulation

For each checkpoint:

- entering the radius opens a visit (if needed)
- leaving sets `departureRecordedAt`
- while both pings of a pair are inside the radius, classify the interval as slowed if implied speed is below the threshold; accumulate seconds and set `firstSlowedAt` on the first slowed interval

### Re-entry

If the athlete re-enters after a completed visit, a new visit is created when the return is **backward on course progress** (unplanned return). Planned out-and-back should be modeled as a **second checkpoint id** in the course file.

---

## 5. ETA interaction

Finish ETA planning adds remaining planned stop budgets for checkpoints not yet reached, plus any remaining planned budget for the current in-progress slowed visit (when applicable).

---

## 6. Manual stop + resolved source APIs

These are crew mutations on the race room aggregate:

- `POST /race-rooms/:roomId/checkpoints/:cpId/manual-stop`
- `PATCH /race-rooms/:roomId/checkpoints/:cpId/visits/:visitIndex/resolved-source`

**AuthZ (MVP):** athletes cannot call these endpoints; crew roles (`crew_member`, `crew_chief`, `team_manager`) can.

**Entitlement:** mutations require the same paid entitlement gate as other room operations.

---

## 7. Offline / outbox expectations

Mobile should enqueue checkpoint operations into the outbox for later flush; the server remains authoritative and replays pings by `recordedAt`.

---

## 8. Validation matrix (high level)

Minimum proof set:

1. Fly-through at race pace → no slowed time / no counter
2. Short slowdown inside radius → partial accumulation
3. Long chair stop → large accumulation
4. Manual stop overlaps auto window → dual storage, default remains `auto` until toggled
5. Toggle `manual_crew` updates active totals
6. Athlete cannot mutate timing endpoints

Full automated coverage lives in API unit tests (`services/api/src/lib/raceProjection.test.ts`, `services/api/src/routes/raceRoomProjection.test.ts`).

---

## 9. Revision history

| Date | Change |
| --- | --- |
| 2026-04-22 | Initial detailed requirements authored (multi-visit model, manual/auto coexistence, ETA adjustments). |
| 2026-04-22 | Implementation shipped to `main` via PR #112; added staging smoke companion doc and tightened crew-only mutation authz. |
