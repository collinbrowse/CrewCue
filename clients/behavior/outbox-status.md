# outbox-status

## Entry
crewcue://dev/outbox

## Action
Open outbox status and see pending operations. A flush removes only the ids it sent.

## API
Outbox flush posts each pending operation to its route.

## Permissions
none

## Success
Shows pending operations that are safe to retry, including one pending ping when the fixture overlay is used.

## Empty
Nothing waiting. Everything is uploaded.

## Error
The server turned down a change, so it won't upload.

## Offline
No signal. These upload once this phone is back online.

## Accessibility labels
- crewcue.outbox

## Native SDK pocket
none
