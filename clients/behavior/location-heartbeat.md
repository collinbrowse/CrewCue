# location-heartbeat

## Entry
crewcue://dev/location-heartbeat

## Action
The athlete taps Start tracking. The phone keeps one location sample per interval (Settings, default 3 minutes), including with the screen locked. Each sample is queued with a strictly increasing recordedAt (the fix's own time). Every pending sample is sent in one batch request whenever the phone has service, and the backlog flushes when the network returns. Tracking resumes after a relaunch and stops on Stop tracking or when the server reports the finish crossed. Crew sessions never sample or upload; they see "Location comes from the runner's phone." A stale_recorded_at result is dropped; duplicate counts as sent.

## API
POST /race-rooms/:roomId/pings/batch

## Permissions
location always (iOS asks When In Use, then Always; Android asks fine location, then "all the time", and shows a foreground-service notification while tracking). Android only: until CrewCue is exempt from battery optimization, the athlete's Location section says "Android may stop tracking to save battery. Set CrewCue's battery use to Unrestricted." with Open battery settings (App info). It is checked again each time the app returns to the foreground.

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
- crewcue.location-battery (Android only)

## Native SDK pocket
location

## Proof
Real phone only (`"proof": "physical"` in deeplinks.json). A simulator or emulator fakes GPS and never ends the app to save power, so it can't show this row. The proof sets `deviceClass: "physical"`, and its `checked.Action` must cover:
- Screen locked in a pocket for at least 2 hours, one sample per interval on the server.
- The app ended by the system or the debugger, not swiped away. Samples resume without the athlete opening the app.
- Real loss of service (no coverage or airplane mode). The backlog reaches the server in one batch when service returns.
- Android: a Samsung or other OEM phone with its default battery settings, not only a Pixel.
