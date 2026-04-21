# Chunk D3 — WS7 aggregate replay SOP

**Audience:** operators and engineers supporting WS7 evented race room flows.  
**Strategy:** [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md) (Chunk D3).  
**Related:** [ws7-execution-sequence.md](./ws7-execution-sequence.md) · [ws7-sprint-signoff.md](./ws7-sprint-signoff.md)

---

## 1. What this SOP covers

WS7 exposes two operator-facing read paths for `race_room` aggregate debugging:

1. `GET /platform/v1/events?aggregateType=race_room&aggregateId=...`
2. `GET /platform/v1/aggregates/race_room/:aggregateId/replay`

Both routes require a valid Bearer token and race room membership. Use them together, but for different jobs.

---

## 2. When to replay vs when to list events

### Use replay when you need the current derived state quickly

Call `GET /platform/v1/aggregates/race_room/:aggregateId/replay` when the question is:

- "What state does the reducer think this room is in right now?"
- "Did the aggregate ever reach `active` or `completed`?"
- "What is the latest plan version the replay reducer can see?"

Replay is the fastest way to answer those questions because it returns a single reduced snapshot instead of the raw event stream.

### Use event listing when you need the audit trail

Call `GET /platform/v1/events?aggregateType=race_room&aggregateId=...` when the question is:

- "Which events actually landed, and in what sequence?"
- "Was an event duplicated or missing?"
- "What payload, actor, correlation id, or causation id was written?"

Listing events is the better first step for incident debugging because it shows the ordered envelopes exactly as stored.

### Important reducer limitation

The current `race_room` replay reducer only folds these event types into the snapshot:

- `race_room.draft_created`
- `race_room.activated`
- `race_room.completed`
- `plan_version.recorded`

Other events can still exist in the event listing and still matter operationally, even if they do not change the replay snapshot today.

---

## 3. Curl examples

Replace the placeholders before running:

- `<ACCESS_TOKEN>`: Bearer token for a user who is a member of the room.
- `<AGGREGATE_ID>`: the `race_room` aggregate id.
- `<API_BASE_URL>`: API origin such as `http://localhost:4000`.

### List raw events for one race room aggregate

```bash
curl -sS \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "<API_BASE_URL>/platform/v1/events?aggregateType=race_room&aggregateId=<AGGREGATE_ID>"
```

Typical response shape:

```json
{
  "events": [
    {
      "id": "9b8d...",
      "aggregateId": "room_123",
      "aggregateType": "race_room",
      "eventType": "race_room.draft_created",
      "occurredAt": "2026-04-21T17:00:00.000Z",
      "sequence": 1,
      "idempotencyKey": "evt-draft-1",
      "payload": {
        "teamId": "team-1",
        "athleteId": "athlete-1",
        "name": "Boston build"
      },
      "schemaVersion": "2026-04-16",
      "transport": "cloud",
      "actorUserId": "athlete-user"
    }
  ]
}
```

### Replay one race room aggregate into a snapshot

```bash
curl -sS \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "<API_BASE_URL>/platform/v1/aggregates/race_room/<AGGREGATE_ID>/replay"
```

Typical response shape:

```json
{
  "snapshot": {
    "aggregateId": "room_123",
    "teamId": "team-1",
    "athleteId": "athlete-1",
    "name": "Boston build",
    "status": "active",
    "lastPlanVersion": 3,
    "lastActivatedEventEndsAt": "2026-04-21T19:30:00.000Z"
  }
}
```

---

## 4. `ReplayedRaceRoomAggregate` fields

The replay route returns `snapshot`, whose shape is defined by the shared contracts type `ReplayedRaceRoomAggregate`.

- `aggregateId`: the race room aggregate id used for the replay.
- `teamId`: set after `race_room.draft_created`.
- `athleteId`: set after `race_room.draft_created`.
- `name`: set after `race_room.draft_created`.
- `status`: reducer-derived room status. Current values are `draft`, `active`, `completed`, or `unknown` when no recognized state-setting event has been folded yet.
- `lastPlanVersion`: highest `plan_version.recorded.payload.version` seen in the event stream.
- `lastActivatedEventEndsAt`: copied from the latest folded `race_room.activated.payload.eventEndsAt`.

Operationally, absent optional fields usually mean one of two things:

1. The relevant event has not been written yet.
2. The event exists, but it is not one of the event types the current reducer folds into the snapshot.

---

## 5. Persistence note

Replay reads from the same underlying platform event store as event listing:

- With persistence enabled (`PERSISTENCE_MODE=postgres`), WS7 reads the aggregate stream from persisted Postgres-backed storage.
- With room persistence off (`PERSISTENCE_MODE=memory`; sometimes described operationally as "room persistence off"), WS7 reads from the in-process in-memory store only.

That means in-memory mode is useful for local development and tests, but it is not restart-safe. If the API process restarts while persistence is off, previously appended platform events disappear and both event listing and replay will return only what has been written since the restart.

---

## 6. Operator workflow

1. Start with **event listing** to confirm the ordered stream and see whether the expected event envelopes exist.
2. Run **replay** to confirm the reducer's current view of the aggregate.
3. If the event stream looks correct but replay looks incomplete, check whether the missing state depends on an event type the current reducer does not fold yet.
4. If the aggregate appears empty after a restart, verify whether the service was running in memory mode instead of Postgres-backed persistence.

---

## 7. Revision history

| Date | Change |
| --- | --- |
| 2026-04-21 | Initial publication for Chunk D3 replay SOP and operator guidance. |
