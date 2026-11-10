# Data flow

End-to-end paths for the flows that matter on race day. Routes and guards: [generated/api-routes.md](generated/api-routes.md). Tables: [generated/data-model.md](generated/data-model.md).

## 1. Runner location → crew readouts

The product invariant: progress comes from the **runner's phone**, never a crew phone's GPS ([AGENTS.md](../../AGENTS.md)).

```mermaid
sequenceDiagram
  participant R as Runner phone
  participant O as Outbox (client-core)
  participant A as API
  participant DB as Postgres
  participant C as Crew phone
  R->>O: enqueuePing (athlete role only, recordedAt > watermark)
  O->>A: POST /race-rooms/:id/pings/batch (≤500)
  A->>A: member + athlete + entitlement, accuracy, clock skew ≤120 s, speed ≤15 m/s
  A->>DB: room_ws2_runtime_json (last 50), room_athlete_pings (all)
  A->>A: recompute projection
  C->>A: GET /race-rooms/:id/pings/latest (every 30 s)
  A-->>C: lastAccepted + progressMeters
  C->>C: RunnerProgress → RaceDayReadouts
```

1. **Capture.** iOS `RaceTrackingLocator` (Always authorization, background location mode) or Android `RaceTrackingService` (location foreground service). `PingPolicy.mayUpload` allows only the athlete role; `LocationUploadGate` throttles. Code: [RaceTracking.swift](../../packages/client-core/Sources/CrewCueClientCore/RaceTracking.swift), [LocationUploadGate.swift](../../packages/client-core/Sources/CrewCueClientCore/LocationUploadGate.swift).
2. **Queue.** [OutboxStore.swift](../../packages/client-core/Sources/CrewCueClientCore/OutboxStore.swift) persists pings to disk with a per-room `recordedAt` watermark. Cap 2000 pending per room; oldest dropped beyond that.
3. **Upload.** `RaceDayAPI.flushOutbox` posts batches. 422 `stale_recorded_at` → dropped; network error → stays pending; 401 → session expired ([Outbox.swift](../../packages/client-core/Sources/CrewCueClientCore/Outbox.swift)).
4. **Ingest.** `POST /race-rooms/:roomId/pings` and `/pings/batch` in [raceRooms.ts](../../services/api/src/routes/raceRooms.ts). Under the room runtime lock: monotonic `recordedAt`, speed gate, then the WS2 snapshot (last 50 pings), `room_athlete_pings` (`ON CONFLICT DO NOTHING`, so replays are idempotent; [athletePingTrack.ts](../../services/api/src/lib/athletePingTrack.ts)), projection recompute.
5. **Read.** `GET /race-rooms/:roomId/pings/latest` serves the in-memory last accepted ping and projected progress. `GET …/pings/track` pages the durable table (≤2000).
6. **Render.** `RaceDayAPI.latestPing` → `RunnerProgress` → `RaceDayReadouts.make` ([RaceDayReadout.swift](../../packages/client-core/Sources/CrewCueClientCore/RaceDayReadout.swift)). A ping older than 15 min is stale and drops the on-track call.

## 2. Projection and pacing

- **Pre-race estimate.** `POST /pacing-estimates` ([pacingEstimates.ts](../../services/api/src/routes/pacingEstimates.ts)): `decidePlanAuthority` picks whose history counts; inputs are activity history, finished efforts, and the course-history cohort; the micro-model runs synchronously ([pacingEstimate/microModel](../../services/api/src/lib/pacingEstimate/microModel)); result saved.
- **Plan of record.** `PUT /race-rooms/:roomId/pacing-estimate` ([raceRoomSchedule.ts](../../services/api/src/routes/raceRoomSchedule.ts)) attaches an estimate to the room and refreshes the projection. `GET …/schedule` serves the stop schedule.
- **Live projection.** Each accepted ping runs `recomputeProjectionForSamples` → [raceProjection.ts](../../services/api/src/lib/raceProjection.ts). With `PROJECTION_TUNED_CONSTANTS` on, it blends the course-history cohort ([courseHistory/resolve.ts](../../services/api/src/lib/courseHistory/resolve.ts), 5 min cache) and adds arrival windows ([arrivalWindows.ts](../../services/api/src/lib/arrivalWindows.ts)).
- **Finish.** The first finish crossing records a finished effort and a CrewCue course-history entry, which feed later estimates.

## 3. Chat and push

- Messages live on **Stream**; the API never sees message bodies ([ADR 0007](../adr/0007-mvp-plaintext-crew-chat.md)).
- `POST /chat/stream-token` mints a 1 h Stream token; Stream user id is `u-` + sha256(sub) ([streamChat.ts](../../services/api/src/lib/streamChat.ts)).
- Room membership changes sync to the Stream channel, fire-and-forget ([streamChannelMembers.ts](../../services/api/src/lib/streamChannelMembers.ts)).
- `POST /chat/push/webhook` accepts the signed-in sender or the `x-crewcue-chat-push-secret` header, filters recipients by prefs, and calls `dispatchChatPush`. The default transport **only logs**: APNs/FCM are not wired ([chatPushDispatch.ts](../../services/api/src/lib/chatPushDispatch.ts)).
- Clients queue device tokens through the outbox (`enqueuePush`).
- Retention: a 6 h in-process interval deletes notification prefs ([chatRetentionScheduler.ts](../../services/api/src/lib/chatRetentionScheduler.ts)). Stream messages are deleted by an operator ([chat-retention.md](../runbooks/chat-retention.md)).

## 4. Activity import, Strava, GPX, course history

- **Activity files**: `POST /activity-history/file` takes a base64 GPX, FIT, or TCX file (10 MB cap, content-hash dedupe), parsed by map-core into one activity summary ([activityHistory.ts](../../services/api/src/routes/activityHistory.ts)). This is v1's way to bring in history.
- **Strava** (off in v1 clients behind `ClientFeatureFlags.stravaEnabled`; API routes still live) ([stravaRoutes.ts](../../services/api/src/routes/stravaRoutes.ts)): OAuth with a per-user state; `/strava/oauth/redirect` bounces to the `crewcue://strava` deep link; the callback stores tokens; `/strava/sync` refreshes and upserts activities into activity history.
- **GPX**: `/activity-history/gpx` and `/course/gpx-preview` take up to 10 MB ([gpxLimits.ts](../../services/api/src/lib/gpxLimits.ts)); parsed synchronously in [map-core courseParse.ts](../../packages/map-core/src/courseParse.ts). Clients queue imports in the outbox.
- **Course history**: OpenSplitTime results come in through operator scripts ([sources/openSplitTime.ts](../../services/api/src/lib/courseHistory/sources/openSplitTime.ts)); `COURSE_HISTORY_PRODUCT_SOURCES` picks which sources the product uses.

## 5. Rooms, invites, join

- **Create**: `POST /race-rooms` with `Idempotency-Key`; room id derived from sub + key. The creator becomes the first member with the role they choose.
- **Invite**: an inviter (athlete, crew chief, team manager) creates a UUID token, 24 h default. Accept adds or changes the caller's membership under the room lock.
- **Join by code**: any signed-in user with the 6-digit code joins as `crew_member`. `GET /race-rooms/join-preview/:roomCode` is public and rate-limited per IP.

## 6. Auth

Auth0 web sign-in on the phone → access token → `Authorization: Bearer` on every client-core request → API verifies against Auth0 JWKS → `request.identity` = {sub, email, teamIds, roomRoles} ([authIdentity.ts](../../services/api/src/lib/authIdentity.ts)). No refresh token on the clients today; a 401 expires the session and wipes per-user stores.

## 7. Account deletion

Settings → Delete account → confirm → `AccountDeletion.run` → `RaceDayAPI.deleteAccount` → `DELETE /me` ([AccountDeletion.swift](../../packages/client-core/Sources/CrewCueClientCore/AccountDeletion.swift), [RaceDayAPI.swift](../../packages/client-core/Sources/CrewCueClientCore/RaceDayAPI.swift:464), [accountRoutes.ts](../../services/api/src/routes/accountRoutes.ts:17)). Only a confirmed delete signs the app out, which wipes the session, outbox and per-user caches; offline, 502 (data gone, Auth0 login not removed) and other failures keep the user signed in to retry. iOS calls it from [AccountDeletionModel.swift](../../apps/ios/CrewCue/Screens/Settings/AccountDeletionModel.swift); Android has the `deleteAccount` bridge op ([RuntimeBridge.swift](../../packages/client-core/Sources/CrewCueClientCore/RuntimeBridge.swift:1475)) but no Settings row yet. Spec: [account-deletion.md](../../clients/behavior/account-deletion.md).
