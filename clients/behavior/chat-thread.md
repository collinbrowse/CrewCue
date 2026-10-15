# chat-thread

## Entry
crewcue://dev/chat

## Action
Open Chat. The app mints a Stream token and shows the room channel. Mentions parse crew names. Chat outbox mutations for one room run one at a time.

## API
POST /chat/stream-token. Channel id is crew-{roomId}.

## Permissions
none

## Success
Stream channel is open. Fixture overlay mentions Ada.

## Empty
No messages.

## Error
Couldn't open the channel.

## Offline
Offline. Message queued on this device.

## Accessibility labels
- crewcue.chat

## Native SDK pocket
stream
