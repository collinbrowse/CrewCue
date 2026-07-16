# Crew chat — manual smoke runbook

Prove MVP plaintext crew chat on staging (or local API + Stream). Anything failing here blocks promotion.

## 0. Preconditions

- Two devices (or one device + simulator) logged in as different members of the same crew with `eventEndsAt` in the future.
- API deployed with `STREAM_API_KEY` / `STREAM_API_SECRET`.
- Mobile `EXPO_PUBLIC_API_BASE_URL` and Stream key configured for the build.
- Push (optional for basic smoke): see [chat-push.md](./chat-push.md).

## 1. Open chat and send

1. Cold-start the app on Device A. Open the Chat tab.
2. Confirm the channel loads with “Loading messages…” only briefly — **never** a lasting “Syncing secure chat…” state.
3. Send a text message ("hello from A").
4. On Device B, open the same crew chat.
5. **Pass:** Device B sees the message with the correct sender label and bubble alignment (others-left).
6. **Pass:** Device A sees the read-by-everyone indicator after Device B has viewed the message.

## 2. Realtime + typing

1. From Device B, start typing in the composer (do not send).
2. **Pass:** Device A sees a typing indicator within about 1 second.
3. Device B clears the composer.
4. **Pass:** Indicator disappears within a few seconds.

## 3. Mentions

1. From Device A, type `@`. Confirm the suggestion sheet shows crew members.
2. Insert Device B's display name and send.
3. **Pass:** On Device B, the mention text is bolded.
4. If push is wired: Device B with preference `mentions` receives a push; with `none`, does not.

## 4. Reactions

1. Long-press a message bubble. Confirm the fixed reaction set.
2. Tap a reaction.
3. **Pass:** Both devices show the reaction count.

## 5. Image attachment

1. From Device A, pick a gallery image and send.
2. **Pass:** Upload progress / pending state appears, then the image delivers.
3. **Pass:** Device B sees the image.
4. If permission is denied, the composer shows a clear permission error (not a silent no-op).

## 6. Send failure / retry

1. Put Device A in airplane mode.
2. Send a text message; confirm pending then failed with retry.
3. Disable airplane mode and tap retry.
4. **Pass:** Message sends and appears on Device B.

## 7. Load error recovery

1. With network blocked, open chat (or tap Retry after a forced failure).
2. **Pass:** An error card with **Retry** appears; Send explains if chat is still connecting.
3. Restore network, tap Retry.
4. **Pass:** Chat loads and Send works.

## 8. Retention banner

1. Use a room whose event has ended (or wait until `eventEndsAt` is past).
2. **Pass:** Banner shows the chat removal date consistent with the retention policy.

## Notes

- Old messages that only stored encrypted custom fields (pre–ADR 0007) may not show readable text. New messages use Stream `text`.
- Encryption is out of MVP; see [ADR 0007](../adr/0007-mvp-plaintext-crew-chat.md).
