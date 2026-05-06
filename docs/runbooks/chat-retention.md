# Crew chat — retention runbook

Phase 7 of the [Crew Chat E2E Implementation Plan](../sdlc/agent-handoff.md). The retention scheduler is what enforces the "30 days after the race ends" promise made to crew members on the chat retention banner.

## Policy summary

- Trigger: `now - room.eventEndsAt >= 30 days`.
- Effect:
  - Server-side metadata is purged: `chat_device_keys`, `chat_channel_envelopes`, `chat_notification_prefs`, `chat_push_tokens` rows scoped to the room are deleted by `deleteChatRoomData(roomId)` in `services/api/src/lib/chatPersistence.ts`.
  - Stream Chat channel deletion (which removes ciphertext) is performed by the operator via the Stream server SDK (see Section 3 below) — the in-process scheduler currently logs `chat_retention_pass` and returns the eligible room ids so an SRE can fan out the SDK call.
- Idempotent: rerunning the pass on already-cleaned rooms is a no-op.
- Client banner: `apps/mobile/src/features/chat/retention.ts` mirrors the policy so the persistent banner copy ("Crew chat will be removed on `<date>`") matches what the server enforces.

## Scheduler

`services/api/src/lib/chatRetentionScheduler.ts` runs on the API process via `setInterval`, default cadence 6 hours, started from `services/api/src/server.ts` and stopped on `SIGINT`/`SIGTERM`. Each pass:

1. Calls `listRaceRoomsForRetention()` (in-memory in dev/test, Postgres in staging/prod).
2. Filters via `isRoomEligibleForChatDeletion`.
3. Calls `deleteChatRoomData(room.id)` and logs `chat_retention_pass` with `{ scanned, purged, rooms }`.

Scheduler errors do not crash the process — they log `chat_retention_pass_failed` and the next interval retries.

## Manual smoke (staging)

Use this when verifying a release or when the scheduler logs go quiet.

```bash
# 1. Confirm scheduler is running
fly logs -a crewcue-api | rg chat_retention_pass

# 2. Force a pass (one-off):
node --eval "
  process.env.PERSISTENCE_MODE='postgres';
  process.env.DATABASE_URL='$(fly ssh console -a crewcue-api -C \"printenv DATABASE_URL\")';
  const { listRaceRoomsForRetention } = await import('./services/api/dist/services/api/src/routes/raceRooms.js');
  const { runChatRetentionScheduledPass } = await import('./services/api/dist/services/api/src/lib/chatRetentionScheduler.js');
  const log = { info: console.log, warn: console.warn };
  const r = await runChatRetentionScheduledPass(listRaceRoomsForRetention, log);
  console.log({ purged: r.length });
"
```

## End-to-end staging soak

1. Provision a race room with `eventEndsAt` set to 30 days + 1 minute in the past.
2. Send a few chat messages from a dev client (Phase 4 + Phase 5).
3. Confirm `chat_channel_envelopes` rows exist via psql.
4. Wait one scheduler tick or run the manual pass above.
5. Confirm the rows are gone, the API logs `chat_retention_pass` with the room id in `purged`, and Stream's dashboard for that channel returns 404 once the operator runs the SDK delete (Section 3).

## Stream channel deletion (operator step)

The scheduler does not yet hold Stream credentials (they live in the deployment env). Once `STREAM_API_KEY` / `STREAM_API_SECRET` are configured in the API tier, extend `services/api/src/lib/chatRetentionScheduler.ts` so the pass also calls:

```ts
import { StreamChat } from "stream-chat";
const client = StreamChat.getInstance(STREAM_API_KEY, STREAM_API_SECRET);
for (const result of results) {
  await client.channel("messaging", chatChannelIdForRoom(result.roomId)).delete({ hard_delete: true });
}
```

Until that is wired, run the deletion manually after each scheduled pass that returns purged room ids.

## Observability

- Datadog log filter: `service:crewcue-api @msg:chat_retention_pass`.
- Alert if `purged > 0` and Stream channel still exists 24 hours later (means the operator step was missed).
- Alert if `chat_retention_pass_failed` fires more than twice in a row.

## Disabling the scheduler

If the scheduler must be disabled (e.g. for a database migration), set the API process env `CHAT_RETENTION_DISABLED=1` and redeploy. Add the early-return inside `startChatRetentionScheduler` if/when the flag is needed in production.

## Rollback

The retention pass is destructive (drops envelopes / push tokens). To recover from an erroneous run:

- Envelopes: re-run the per-device wrap flow on the next mobile launch (Phase 3 `bootstrapChannelKey` regenerates the channel key if needed).
- Notification prefs: users can reselect via `ChatNotificationPrefsScreen`.
- Push tokens: each device re-registers on next foreground.

Plaintext message history is unrecoverable by design — that is the entire point of the retention policy. No "undo" is required because the operator confirmed the policy at sign-up.
