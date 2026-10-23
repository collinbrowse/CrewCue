# location-heartbeat

## Entry
crewcue://dev/location-heartbeat

## Action
Athlete session queues a location sample with a strictly increasing recordedAt. Crew sessions do not upload pings. A 422 stale_recorded_at is dropped.

## API
POST /race-rooms/:roomId/pings

## Permissions
location when in use

## Success
Location sample queued.

## Empty
No location sample yet.

## Error
Location permission was denied.

## Offline
Offline. Sample queued in the outbox.

## Accessibility labels
- crewcue.location-heartbeat

## Native SDK pocket
location
