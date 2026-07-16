# Crew chat — push notifications (MVP)

MVP chat is **plaintext** on Stream ([ADR 0007](../adr/0007-mvp-plaintext-crew-chat.md)). Push fan-out does **not** require on-device decryption.

## Behavior

1. Clients register a push device via `POST /chat/devices` (or `POST /chat/push/tokens`) with a stable per-install `deviceId`.
2. Stream (or an operator test) hits `POST /chat/push/webhook` with recipient user ids, room id, optional `mentionedUserIds`, and optional `previewText`.
3. The API filters by notification preference (`all` / `mentions` / `none`), looks up device tokens, and dispatches via the configured APNS/FCM transport.
4. Notification body is `previewText` when present, otherwise the generic copy: **New Message in Crew Chat**.

## Local / staging checks

1. Confirm the mobile app registered a device after opening chat (API logs or DB/`chat_push_devices`).
2. POST a webhook payload with `previewText: "hello from soak"` and verify the device receives that body (or the generic fallback if the transport strips data).
3. Flip notification preference to `none` and confirm no delivery; `mentions` only when `mentionedUserIds` includes the user.

## What was removed

The Notification Service Extension / FCM decrypt path (`withChatPushDecryption`, App Group channel keys, encrypted preview blobs) was removed with ADR 0007. Do not reintroduce it without a new encryption ADR.

## Related

- [chat-smoke.md](./chat-smoke.md) — end-to-end chat smoke
- [chat-retention.md](./chat-retention.md) — post-race purge
