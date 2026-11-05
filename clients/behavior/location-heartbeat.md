# location-heartbeat

## Entry
crewcue://dev/location-heartbeat

## Action
The athlete taps Start tracking. The phone keeps one location sample per interval (Settings, default 3 minutes), including with the screen locked. Each sample is queued with a strictly increasing recordedAt (the fix's own time). Every pending sample is sent in one batch request whenever the phone has service, and the backlog flushes when the network returns. Tracking resumes after a relaunch and stops on Stop tracking or when the server reports the finish crossed. Crew sessions never sample or upload; they see "Location comes from the runner's phone." A stale_recorded_at result is dropped; duplicate counts as sent.

## API
POST /race-rooms/:roomId/pings/batch

## Permissions
location always (iOS asks When In Use, then Always; Android asks fine location, then "all the time", and shows a foreground-service notification while tracking)

## Success
Tracking. A sample every 3 min. After each sample reaches the server: Location sample sent.

## Empty
No location sample yet.

## Error
Location permission was denied. Turn it on in Settings to share your position.

## Offline
Offline. Sample queued in the outbox.

## Accessibility labels
- crewcue.location-heartbeat
- crewcue.location-interval

## Native SDK pocket
location
