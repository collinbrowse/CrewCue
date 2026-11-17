# Crew chat: push notifications

Chat push goes straight from the API to APNs (iOS) and FCM (Android). See [ADR 0011](../adr/0011-first-party-crew-chat.md).

## How it works

1. Each app registers its token with `POST /chat/push/tokens` (through the outbox): `deviceId` (stable per install), `platform`, `token`, and on iOS `apnsEnvironment` (`development` for debug builds, `production` for TestFlight and App Store).
2. When a message is stored, the API pushes to every other room member whose preference allows it: `all`, or `mentions` when the text has `@TheirName`. `none` gets nothing. The sender never gets their own push.
3. Title is the race name; body is `Sender: text` (140 characters at most) or `Sender sent a photo`. The payload carries `type: "chat"` and `roomId`; tapping it opens that room's chat.
4. Check-in ETA alerts use the same path with `type: "schedule"`. Tracking reminders (the runner only, 45 and 5 minutes before the start of a paid race when they aren't tracking yet) use it with `type: "tracking"`; rules in [location-pings.md](../api/location-pings.md#tracking-reminders-push). Neither app routes a `tracking` tap yet ([tracking-reminder.md](../../clients/behavior/tracking-reminder.md)).
5. A 410/`BadDeviceToken`/`Unregistered` (APNs) or `UNREGISTERED`/404 (FCM) deletes that device row. 429 and 5xx retry twice with backoff. Each provider request times out after 10 s. A push with an expiry (tracking reminders) sets `apns-expiration` and FCM `android.ttl`, and is not sent (failure reason `expired`) once that time has passed.

With nothing configured the API logs `chat_push_dispatch` and sends nothing.

## Owner inputs (API service variables)

| Variable | What | Where it comes from |
| --- | --- | --- |
| `APNS_KEY_P8` | Contents of the APNs auth key `.p8` (PEM; `\n` escapes or base64 are fine) | Apple Developer > Keys > + > Apple Push Notifications service |
| `APNS_KEY_ID` | The key's 10-character id | Same page |
| `APNS_TEAM_ID` | Apple team id | Apple Developer > Membership |
| `APNS_TOPIC` | iOS bundle id, `com.crewcue.ios` | Xcode target |
| `FCM_SERVICE_ACCOUNT_JSON` | Service account JSON (raw or base64) with the Firebase Cloud Messaging API enabled | Firebase console > Project settings > Service accounts > Generate new private key |

App-side inputs:

- iOS: the App ID `com.crewcue.ios` needs the Push Notifications capability (Apple Developer > Identifiers). The entitlement is in the repo.
- Android: `apps/android/app/google-services.json` for package `com.crewcue.android` from the same Firebase project (Firebase console > Project settings > Your apps > Android). It is not committed.

## Photos (bucket variables)

| Variable | Railway bucket credential |
| --- | --- |
| `CHAT_PHOTO_BUCKET` | Bucket name |
| `CHAT_PHOTO_ENDPOINT` | Endpoint, e.g. `https://t3.storageapi.dev` |
| `CHAT_PHOTO_ACCESS_KEY_ID` | Access key id |
| `CHAT_PHOTO_SECRET_ACCESS_KEY` | Secret access key |
| `CHAT_PHOTO_REGION` | Optional, default `auto` |
| `CHAT_PHOTO_URL_STYLE` | Optional, `virtual` (default, Railway) or `path` |

Use Railway variable references to the bucket service. Without a bucket, production answers photo uploads with 503; local dev keeps photos in memory.

## Checks

1. Sign in on a physical phone, allow notifications, open Settings > This device. `chat_push_devices` gets a row for the user.
2. Background the app. From a second account in the same race, send a message. The phone shows "Race name / Sender: text".
3. Tap it: the app opens that race's chat.
4. Set alerts to `none` and send again: nothing arrives. Set `mentions`: only `@Name` messages arrive.
5. API logs `chat_push_dispatched` with `delivered`, `failures` and `pruned` counts (never message text or tokens).
6. Tracking reminder: set a paid race's start about 50 minutes out (`PATCH /race-rooms/:roomId/race-start`) and don't track. At T-45 the runner's phone shows "Start tracking / Your race starts in 45 minutes. …" and the API logs `tracking_reminder_sent`; a crew phone gets nothing. `SELECT slot, race_start_at, sent_at FROM tracking_reminders_sent WHERE room_id = '<id>'` shows one row per reminder sent. A sent reminder is never retried; to test again, move the start, which re-arms both for the new start.

Simulators can't receive real APNs/FCM pushes from this path, so step 2–3 needs a real device.

## Related

- [chat-smoke.md](./chat-smoke.md)
- [chat-retention.md](./chat-retention.md)
