# Crew chat: manual smoke

Proves first-party crew chat ([ADR 0010](../adr/0010-first-party-crew-chat.md)) on staging or a local API. A failure here blocks promotion.

## Preconditions

- Two signed-in members of the same race on two devices (one iOS and one Android is best).
- The API has a photo bucket (see [chat-push.md](./chat-push.md#photos-bucket-variables)); push is optional for steps 1–5.

## 1. Live text both ways

1. Open the race's Chat on both devices.
2. Send "hello from A" on A.
3. **Pass:** B shows it within a couple of seconds, labelled with A's name in this race, without leaving the screen.
4. Reply from B. **Pass:** A shows it live.

## 2. Photo

1. On A, attach a photo and send.
2. **Pass:** A shows it sending, then sent. B shows the photo live.

## 3. Offline send goes out once

1. Put A in airplane mode. Send "queued 1" and "queued 2". **Pass:** both show as queued.
2. Turn the network back on (keep the chat open, or reopen it).
3. **Pass:** both send, in order, and B sees each exactly once.

## 4. Mentions and alerts

1. On B, set Chat alerts to "Mentions only". Background B.
2. From A, send a plain message. **Pass:** no push on B.
3. From A, send `@BName ping`. **Pass:** B gets a push titled with the race name.
4. Tap it. **Pass:** the app opens that race's chat.

## 5. Removed member

1. The race owner removes B while B has the chat open.
2. **Pass:** B's chat stops updating and sending fails with an access error.

## 6. API restart

1. Restart the API service while both chats are open.
2. **Pass:** within a minute both reconnect on their own; a message sent after the restart arrives live.
