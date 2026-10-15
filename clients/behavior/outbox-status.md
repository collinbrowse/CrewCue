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
Outbox is empty.

## Error
Rejected by server policy.

## Offline
Network error. Will retry when the app is active.

## Accessibility labels
- crewcue.outbox

## Native SDK pocket
none
