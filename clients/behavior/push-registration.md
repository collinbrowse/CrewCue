# push-registration

## Entry
crewcue://dev/push-registration

## Action
After permission, queue the device token for registration.

## API
POST /chat/push/tokens via the outbox

## Permissions
notifications

## Success
Push token queued for registration.

## Empty
No push token.

## Error
Push permission was denied.

## Offline
Offline. Token queued.

## Accessibility labels
- crewcue.push-registration

## Native SDK pocket
push
