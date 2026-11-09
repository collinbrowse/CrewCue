# chat-thread

## Entry
crewcue://dev/chat

## Action
Open Chat. The app loads the race's newest messages, then long-polls for newer ones, so messages from crew on either platform appear without a reload. Mentions parse crew names. Sending queues the message in the outbox under a stable client message id and flushes it; the server stores one copy per id, so a retry or a resend after a crash never posts twice. Messages sent offline show "Queued" and go out, in order, on the next successful poll. A photo is uploaded first (it needs a connection) and then sent like a message. Polls that fail back off 1, 2, 4, 8, 16, then 30 seconds and recover on their own, including after an API restart. A refused message shows "Not sent" and can be deleted. Removed from the race, the chat stops and says so.

The header names the race (e.g. "Leadville 100"), or shows nothing. It never shows a room id.

Authors show their display name in this race. Names live on the race-room membership, so one person can have a name in one race and none in another. Client-core `ChatAuthors` labels each message from the roster on the messages page:
- Named member: "Ada".
- Member with no name in this race, or a sender no longer on the roster: "Crew member". Never a user id.
- Own messages: "Pacer Collin (you)", or "You" with no name in this race.

## API
GET /chat/rooms/:roomId/messages (newest page; `after` + `wait=25` long-polls; `before` pages back). POST /chat/rooms/:roomId/messages with clientMessageId, text, optional photoKey. POST /chat/rooms/:roomId/photos with the image bytes.

## Permissions
photos (picker only; no library permission prompt)

## Success
Messages from the crew, labelled by name, update live.

## Empty
No messages.

## Error
Couldn't load chat.

## Offline
Offline. Message queued on this device.

## Accessibility labels
- crewcue.chat

## Native SDK pocket
none
