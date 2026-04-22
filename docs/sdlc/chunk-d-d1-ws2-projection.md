# Chunk D1 — WS2 projection depth (baseline track + anchored ETA)

**Audience:** engineers extending WS2 reads beyond Chunk C smoke.  
**Strategy:** [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md) (Chunk D, stream D1).

---

## 1. What this slice adds

### Server: optional baseline track on projection inputs

`RaceCourse` in `@crewcue/contracts` now accepts an optional `baselineTrack.points[]` payload:

- `distanceMetersFromStart`
- `referenceElapsedSeconds`

When present and valid for the full course length, projection math interpolates this profile instead of using a flat `plannedPaceSecondsPerKm` for planned split timing.

This keeps the existing checkpoint polyline model intact while letting ETA follow a non-linear activity baseline.

### Server: checkpoint-anchored ETA

With `baselineTrack` present:

- `checkpointSplits[].plannedElapsedSecondsAtCross` comes from the interpolated baseline reference time at each checkpoint distance.
- `etaFinishPlanIso` anchors to the latest checkpoint that has an actual crossing time, then adds the baseline's remaining reference time from that checkpoint to the finish.
- ETA therefore stays deterministic within a segment and updates again when the athlete crosses the next checkpoint.

Without `baselineTrack`, WS2 keeps the previous behavior:

- planned checkpoint times use `distanceKm × plannedPaceSecondsPerKm`
- finish ETA uses `recordedAt + remainingDistanceAtFlatPlanPace`

### Server: synthetic weather stub remains unchanged

Each successful `recomputeRaceProjection` still attaches optional `weatherStub` data on `RaceRoomProjectionCore`:

- `source` is always `"stub"` for now (not live weather).
- `summary` and `assumedHeadwindMps` still vary deterministically by course progress.

---

## 2. API behaviour (unchanged routes)

- `POST /race-rooms/:id/activate` — can now include `course.baselineTrack.points[]` in addition to `course.checkpoints[]`.
- `POST /race-rooms/:id/pings` — accepted ping response may still include an inline `projection` object; planned splits / finish ETA use the baseline track when available.
- `GET /race-rooms/:id/projection` — same response shape as before; no client-breaking contract changes.

## 3. Backward compatibility

- `baselineTrack` is optional in contracts and activation payloads.
- Rooms without a baseline track keep the previous flat plan-pace math.
- Existing clients that only know about checkpoint-based courses do not need to change.

---

## 4. Follow-ups (later D1 / provider work)

| Topic | Direction |
| --- | --- |
| Baseline authoring | Generate higher-density baseline tracks from GPX / course planning inputs instead of hand-built arrays. |
| Weather coupling | Replace stub with provider fetch + cache; keep `weatherStub` optional or version the field. |
| Checkpoint ETAs | Surface future checkpoint arrival ETAs explicitly if the UI needs more than split rows + finish ETA. |

---

## 5. Revision history

| Date       | Change |
| ---------- | ------ |
| 2026-04-22 | Added optional `baselineTrack` contract support, baseline-driven planned splits, checkpoint-anchored finish ETA, and backward-compat guidance. |
| 2026-04-21 | Initial slice: `ProjectionWeatherStub` on projection core + mobile 8s poll toggle. |
