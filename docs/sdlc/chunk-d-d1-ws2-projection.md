# Chunk D1 — WS2 projection depth (stub weather + client polling)

**Audience:** engineers extending WS2 reads beyond Chunk C smoke.  
**Strategy:** [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md) (Chunk D, stream D1).

---

## 1. What this slice adds

### Server: synthetic weather baseline on projection

Each successful `recomputeRaceProjection` attaches an optional **`weatherStub`** on `RaceRoomProjectionCore`:

- `source` is always `"stub"` for now (not live weather).
- `summary` and `assumedHeadwindMps` vary deterministically by **fraction of course completed** (`progressMeters / courseLengthMeters`), so early / mid / late segments get different placeholder headwinds.

Types live in `@crewcue/contracts` as `ProjectionWeatherStub`. The helper `buildProjectionWeatherStub` is exported from `services/api/src/lib/raceProjection.ts` for tests and future provider wiring.

### Mobile: projection auto-refresh

When the race room is **active**, the smoke screen can enable **Auto-refresh projection (8s)** to poll `GET /race-rooms/:id/projection` without toggling the global `busy` spinner (timestamps update in the projection card).

---

## 2. API behaviour (unchanged routes)

- `POST /race-rooms/:id/pings` — accepted ping response may still include an inline `projection` object; it now includes `weatherStub` when projection recompute runs.
- `GET /race-rooms/:id/projection` — same shape; `weatherStub` is present whenever a stored core projection exists.

---

## 3. Follow-ups (later D1 / provider work)

| Topic | Direction |
| --- | --- |
| Real weather | Replace stub with provider fetch + cache; keep `weatherStub` optional or version the field. |
| Pace adjustment | Use `assumedHeadwindMps` in ETA math when product agrees on a model. |
| Polling policy | Backoff, foreground-only, and battery caps per `mobile-athlete-ping-battery-deferred.md`. |

---

## 4. Revision history

| Date       | Change |
| ---------- | ------ |
| 2026-04-21 | Initial slice: `ProjectionWeatherStub` on projection core + mobile 8s poll toggle. |
