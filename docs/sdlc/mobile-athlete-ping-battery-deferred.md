# Deferred: Expo athlete ping rate + battery modes

The API already accepts optional **`uploadIntervalSeconds`** on ping ingest and uses it (with bounds) to derive projection **staleness** threshold. The **mobile app** work below is intentionally **not** implemented in this repository slice.

## Product (to build in `apps/mobile`)

1. **Battery / performance setting**  
   - User-visible modes at minimum: **High performance** vs **Battery saver** (copy and exact labels TBD).  
   - Optional: a third “Balanced” tier later.

2. **Race length (or expected duration) input**  
   - Shorter planned effort → **lower** `uploadIntervalSeconds` (more frequent pings).  
   - Longer ultra-style effort → **higher** interval (fewer pings) when in battery saver.

3. **Mapping table (app-local, versioned)**  
   - Define explicit `(mode, raceLengthBucket) → uploadIntervalSeconds` ranges within **10…900** (server validation).  
   - Allow user override / “custom interval” only if product wants it; if so, still send the resulting integer to the API.

4. **Send on every accepted ping**  
   - Include `uploadIntervalSeconds` on each **`POST .../pings`** body so the server can recompute staleness if the athlete changes mode mid-race.

5. **UX**  
   - Surface **`projectionConfidence`** from **`GET .../projection`** (or embedded projection on ping response) so crew sees “stale feed” vs “live” without inferring from silence.

## Hardening (later, cross-cutting)

- **Trust but verify:** server-side max change rate for `uploadIntervalSeconds`, or ignore outliers.  
- **AuthZ:** only the athlete (or designated device role) may set interval if abuse appears.  
- **Telemetry:** client mode + chosen interval for analytics (privacy review).

## Related API docs

- [docs/api/ws2-task1-pings.md](../api/ws2-task1-pings.md) — ingest field  
- [docs/api/ws2-task3-projection-confidence.md](../api/ws2-task3-projection-confidence.md) — staleness math  
