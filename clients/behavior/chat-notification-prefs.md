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
Mentions and check-ins notify when the preference is all or mentions.

## Empty
Alerts are off.

## Error
Couldn't save alert settings.

## Offline
Offline. Alert settings stay on this device.

## Accessibility labels
- crewcue.chat-notification-prefs

## Native SDK pocket
push
