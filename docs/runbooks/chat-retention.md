# Crew chat — retention runbook

Enforces the "30 days after the race ends" promise shown on the chat retention banner ([ADR 0007](../adr/0007-mvp-plaintext-crew-chat.md)).

## Policy summary

- Trigger: `now - room.eventEndsAt >= 30 days`.
- Effect:
  - Server-side metadata is purged: notification prefs and push devices scoped to the room via `deleteChatRoomData(roomId)` in `services/api/src/lib/chatPersistence.ts`.
  - Stream Chat channel deletion (which removes message history) is performed by the operator via the Stream server SDK (see below) — the in-process scheduler logs `chat_retention_pass` and returns eligible room ids.
- Idempotent: rerunning the pass on already-cleaned rooms is a no-op.
- Client banner: `apps/mobile/src/features/chat/retention.ts` mirrors the policy so the banner date matches the server.

## Scheduler

`services/api/src/lib/chatRetentionScheduler.ts` runs on the API process via `setInterval`, default cadence 6 hours, started from `services/api/src/server.ts` and stopped on `SIGINT`/`SIGTERM`. Each pass:

1. Calls `listRaceRoomsForRetention()`.
2. Filters via `isRoomEligibleForChatDeletion`.
3. Calls `deleteChatRoomData(room.id)` and logs `chat_retention_pass` with `{ scanned, purged, rooms }`.

Scheduler errors do not crash the process — they log `chat_retention_pass_failed` and the next interval retries.

## Manual smoke (staging)

```bash
# Confirm scheduler is running (adjust to your host logs)
# Look for chat_retention_pass / chat_retention_pass_failed
```

1. Provision a race room with `eventEndsAt` set to more than 30 days in the past.
2. Send a few plaintext chat messages from a client.
3. Wait one scheduler tick or invoke the retention pass in a controlled environment.
4. Confirm prefs/devices for that room are gone and `chat_retention_pass` includes the room id.
5. Delete the Stream channel (section below) and confirm it is gone in the Stream dashboard.

## Stream channel deletion (operator step)

Once `STREAM_API_KEY` / `STREAM_API_SECRET` are available:

```ts
import { StreamChat } from "stream-chat";
import { chatChannelIdForRoom } from "@crewcue/contracts";

const client = StreamChat.getInstance(STREAM_API_KEY, STREAM_API_SECRET);
for (const roomId of purgedRoomIds) {
  await client.channel("messaging", chatChannelIdForRoom(roomId)).delete({ hard_delete: true });
}
```

Until that is wired into the scheduler, run deletion manually after each pass that returns purged room ids.

## Observability

- Alert if `purged > 0` and the Stream channel still exists 24 hours later.
- Alert if `chat_retention_pass_failed` fires more than twice in a row.

## Disabling the scheduler

Set `CHAT_RETENTION_DISABLED=1` on the API process if the flag is supported in your deployment, or stop the scheduler during migrations.

## Rollback

Retention is destructive. After an erroneous run:

- Notification prefs: users can reselect in the app.
- Push tokens: each device re-registers on next chat open / foreground.
- Message history in Stream is unrecoverable once the channel is hard-deleted — that is intentional.
