# Crew chat: retention

Chat for a race is deleted 30 days after the race ends, as the chat banner promises ([ADR 0011](../adr/0011-first-party-crew-chat.md)).

## Policy

- Trigger: `now - room.eventEndsAt >= 30 days`.
- Effect, via `deleteChatRoomData(roomId)` in `services/api/src/lib/chatPersistence.ts`:
  - every row in `chat_messages` for the room,
  - every photo those messages referenced, from the bucket,
  - the room's notification prefs.
- Push devices belong to users, not rooms, and stay.
- Idempotent: a second pass over a cleaned room deletes nothing.
- Clients compute the banner date from the same rule (`eventEndsAt + 30 days`).

## Scheduler

`services/api/src/lib/chatRetentionScheduler.ts` runs inside the API process every 6 hours (started in `server.ts`, stopped on `SIGINT`/`SIGTERM`). Each pass lists rooms (`listRaceRoomsForRetention()`), keeps the eligible ones, deletes their chat, and logs `chat_retention_pass` with `{ scanned, purged, rooms }`. A failure logs `chat_retention_pass_failed`; the next tick retries.

## Staging check

1. Make a race room whose `eventEndsAt` is more than 30 days ago.
2. Send a few messages, one with a photo.
3. Wait for a scheduler tick (or restart the API, which runs a pass on start).
4. `chat_retention_pass` lists the room. `SELECT count(*) FROM chat_messages WHERE room_id = '<id>'` is 0, and the photo URL from step 2 no longer loads once its signature expires (the object is gone from the bucket).
