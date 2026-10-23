# chat-thread

## Entry
crewcue://dev/chat

## Action
Open Chat. The app mints a Stream token and shows the room channel. Mentions parse crew names. Chat outbox mutations for one room run one at a time. Opening the channel resends queued messages under their stable client message id. Stream answering "already exists" counts as sent.

The header names the race (e.g. "Leadville 100"), or shows nothing. It never shows the channel id.

Authors show their display name in this race. Names live on the race-room membership, so one person can have a name in one race and none in another. Client-core `ChatAuthors` labels each message from the room roster in the token response, never from the global Stream user name:
- Named member: "Ada".
- Member with no name in this race, or a sender no longer on the roster: "Crew member". Never a Stream user id.
- Own messages: "Pacer Collin (you)", or "You" with no name in this race.

## API
POST /chat/stream-token with roomId. The response lists the room's members as streamUserId plus displayName for this room. Channel id is crew-{roomId}.

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
