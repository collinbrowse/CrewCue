# Crew chat — manual smoke runbook

Phase 7 acceptance: a single operator can run through this list on staging in under 30 minutes and prove every Phase 4/5/6/7 acceptance criterion still holds. Anything failing here blocks promotion to production.

## 0. Preconditions

- Two physical devices (one iOS, one Android) on the dev client built per [chat-push-decryption.md](./chat-push-decryption.md).
- Both devices logged in as different members of the same crew with `eventEndsAt` set in the future.
- API deployed with `STREAM_API_KEY` / `STREAM_API_SECRET` and APNS / FCM credentials wired into `chatPushDispatch.ts` transport.
- `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_STREAM_API_KEY` configured in the dev client build.

## 1. First-launch encryption bootstrap

1. Cold-start the app on Device A. Open the Chat tab.
2. Confirm the channel loads (may show "Syncing secure chat…" briefly while keys distribute).
3. Confirm there is **no** fatal "missing room key" error — reinstall recovery uses encrypted identity backup + server envelopes (ADR 0006).
4. Send a plain-text message ("hello from A").
5. On Device B, foreground the app within 10 seconds.
6. **Pass:** Device B sees the message instantly with the correct sender label and bubble alignment (others-left).
7. **Pass:** Device A sees the read-by-everyone indicator after Device B's app has scrolled the message into view.

## 2. Realtime + typing

1. From Device B, start typing in the composer (do not send).
2. **Pass:** Device A sees a "<DisplayName> is typing…" indicator within 1 second.
3. Device B clears the composer.
4. **Pass:** Indicator disappears within 5 seconds.

## 3. Mentions

1. From Device A, type `@`. Confirm the suggestion sheet shows crew members.
2. Insert Device B's display name and send.
3. **Pass:** On Device B's chat, the mention text is bolded.
4. **Pass:** Device B (with notification preference `mentions only`) receives a push.
5. Switch Device B's preference to `none`.
6. Send another mention from Device A.
7. **Pass:** Device B receives no push.

## 4. Reactions

1. Long-press a message bubble on Device A. Confirm the picker shows exactly `["thumbs-up","thumbs-down","heart","laugh","wow","cry","clap"]`.
2. Tap thumbs-up.
3. **Pass:** Both devices show a thumbs-up reaction count of 1 with Device A as the reactor.

## 5. Image attachment

1. From Device A, open the gallery picker, select an image roughly 8 MB.
2. **Pass:** The send progress bar appears inside the bubble while uploading.
3. **Pass:** The delivered image is below 2.5 MB on the wire (verify in Stream's dashboard).
4. **Pass:** Device B sees the image with the same dimensions (downscaled if originally over 1600px on the long edge).

## 6. Send progress / failure / retry

1. Put Device A in airplane mode.
2. Send a text message; confirm bubble shows "sending" state.
3. Wait 30 seconds; bubble switches to "failed" with retry button.
4. Tap retry while still offline; confirm it stays failed.
5. Disable airplane mode.
6. **Pass:** Bubble flips through sending -> sent.
7. **Pass:** On Device B, the message arrives with `arrivedAt` significantly later than `sentAt` (>30 seconds), and swiping left reveals **both** timestamps.

## 7. Timestamps

1. Send a quick burst of 3 messages from Device A while Device B is online.
2. Hold-and-swipe-left on Device B's chat.
3. **Pass:** Each bubble reveals only `sent HH:mm` (no second arrival line because gap < 30 seconds).
4. Repeat the offline test from Section 6 — that bubble should reveal **two** lines.

## 8. Push decryption

Two cases:

### 8a. NSE / FCM service has the channel key

1. Background Device B's app fully (force quit, then reopen briefly to trigger key bridge sync, then force quit again).
2. Send a message from Device A.
3. **Pass:** Lock-screen banner on Device B shows the decrypted body, not "New Message in Crew Chat."

### 8b. NSE / FCM service is missing the key

1. Reinstall the app on Device B to clear keychain / SharedPreferences.
2. Do not open the app yet.
3. Send a message from Device A.
4. **Pass:** Lock-screen banner on Device B shows exactly "New Message in Crew Chat."

## 9. Tab badge

1. Background Device B's app.
2. Send 3 messages from Device A.
3. **Pass:** Re-open Device B; the Chat tab in the bottom tab bar shows badge "3."
4. Open the chat.
5. **Pass:** Badge disappears when the messages scroll into view.

## 10. Retention banner

1. SSH into staging Postgres and set the room's `eventEndsAt` to 1 hour ago.
2. Pull-to-refresh the chat on Device A.
3. **Pass:** Banner copy reads "Crew chat will be removed on `<date>`" with the date 30 days from `eventEndsAt`.
4. Set `eventEndsAt` to 31 days ago.
5. Trigger the manual retention pass per [chat-retention.md](./chat-retention.md).
6. **Pass:** Server logs `chat_retention_pass` with the room id in the `rooms` array.
7. **Pass:** `chat_channel_envelopes` is empty for that room id.

## 11. Failure modes (verify they fail closed)

- API returns 500 on `POST /chat/stream-token`: chat tab shows error state with a retry button, no plaintext leakage.
- Bridge native module missing: pushes fall back to "New Message in Crew Chat" silently.
- Channel key version bump: outgoing messages encrypt with the new version, incoming messages encrypted with the old version still decrypt because the device has both versions cached locally (Phase 3 contract — verify by sending a message before and after rotation).

## Sign-off

Operator notes who ran each section, build hash, and timestamp into a Slack thread tagged `#crewcue-soak` before promoting the build.
