# push-registration

## Entry
crewcue://dev/push-registration

## Action
In Settings, after permission, queue the device token for registration. Signed in, the entry deeplink opens Settings at This device and asks for permission.

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
