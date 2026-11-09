# ADR 0010: First-party crew chat and direct push

## Status

Accepted (2026-11-09). Supersedes [ADR 0007](./0007-mvp-plaintext-crew-chat.md).

## Context

v1 cuts every service that bills per user ([pricing-and-v1-scope.md](../product/pricing-and-v1-scope.md)). Stream Chat bills per monthly active user and adds a large SDK to both native apps. Crew chat needs only a small part of it: one channel per race room, text, a photo, live delivery, and push. Push was never delivered end to end (#563): the API had only a logging transport.

## Decision

1. **Messages live in our Postgres** (`chat_messages`), one thread per race room. Ids are a bigserial and double as the paging cursor. Each message carries the client's `clientMessageId`; `(room, sender, clientMessageId)` is unique, so a retry returns the first message (`duplicate: true`) instead of posting twice.
2. **Live updates are HTTP long-poll**: `GET /chat/rooms/:roomId/messages?after=<id>&wait=25`. It answers at once when newer messages exist, otherwise parks until a message lands, the member is removed (then 403), or the wait ends. Long-poll needs no extra client library on either platform and survives proxies. Wake-ups are in-process, which assumes one API replica; a second replica needs Postgres `LISTEN/NOTIFY` behind `chatLive.ts` (until then a missed wake-up costs at most one wait period).
3. **Photos go in a Railway bucket** (S3-compatible). Clients post raw image bytes to the API (`POST /chat/rooms/:roomId/photos`, 10 MB, JPEG/PNG/HEIC/WebP); the API stores them and returns a key the client puts on the message. Reads use presigned GET URLs that expire after an hour. Signing is a small SigV4 helper, not the AWS SDK. Without a bucket, dev and tests use an in-memory store; production without a bucket refuses photos (503).
4. **Push goes straight to APNs and FCM.** APNs uses a token-based `.p8` key over HTTP/2; FCM uses HTTP v1 with a service-account OAuth token. Both retry 429/5xx, and tokens the provider rejects for good are deleted. iOS registrations say which APNs gateway issued the token (debug builds use development), so a debug token is never sent to production and pruned. Notification prefs (`all` / `mentions` / `none`) still apply; a mention is `@DisplayName` for a room member.
5. **Clients use client-core.** The outbox sends queued chat messages through `POST /chat/rooms/:roomId/messages` with their stable client id, so offline messages go out once on reconnect. The apps keep only their screens, the photo picker and platform push registration.
6. **Stream is removed**: the server SDK, the Stream token and channel-sync routes, the push webhook, the iOS and Android Stream SDKs, and the `STREAM_*` env vars.

## Consequences

- No per-user chat bill and no chat SDK in either app.
- Message bodies are plaintext in our database, as they were in Stream. Encryption remains a blank-slate redesign (ADR 0007 point 4 still holds).
- Old Stream messages are not migrated.
- No reactions, threads, typing indicators or read receipts in v1.
- Owner inputs before push works in production: APNs key (.p8, key id, team id), the Firebase project with its service account, and `google-services.json` for Android. Photos need a Railway bucket. See [chat-push.md](../runbooks/chat-push.md).

## References

- Issue #650 (this decision), #563 (push end to end)
- Runbooks: [chat-push.md](../runbooks/chat-push.md), [chat-smoke.md](../runbooks/chat-smoke.md), [chat-retention.md](../runbooks/chat-retention.md)
