# check-in

## Entry
crewcue://dev/check-in

## Action
Enter arrival and departure and queue a check-in. Departure must be after arrival.

## API
POST /race-rooms/:roomId/checkpoints/:cpId/manual-stop via the outbox with Idempotency-Key

## Permissions
none

## Success
Check-in queued.

## Empty
Arrival and departure are required.

## Error
Departure must be after arrival.

## Offline
Offline. Check-in queued in the outbox.

## Accessibility labels
- crewcue.check-in

## Native SDK pocket
none
