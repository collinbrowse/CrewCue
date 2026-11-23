# chat-notification-prefs

## Entry
crewcue://dev/chat-notification-prefs

## Action
In Settings (the gear on every tab), choose all, mentions, or none for this room. Signed in, the entry deeplink opens Settings at Chat alerts.

## API
GET and POST /chat/rooms/:roomId/notification-prefs

## Permissions
notifications

## Success
All: "Every crew chat message in this race notifies you." Mentions: "Only messages that @mention you, and check-ins."

## Empty
Off: "Crew chat won't notify you. Check-ins still do."

## Error
Couldn't save alert settings.

## Offline
Offline. Alert settings stay on this device.

## Accessibility labels
- crewcue.chat-notification-prefs

## Native SDK pocket
push
