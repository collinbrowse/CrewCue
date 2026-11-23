# course-locked

## Entry
crewcue://dev/course-locked

## Action
Open Pace, Race tools, GPX import on a race that has started. A Race Pass pays for one race, so once the race is used its course line and start time are locked. GPX import shows the lock sentence instead of the text field and the Choose GPX file and Import GPX buttons. Planned stops, aid-station names and checkpoints on the same route stay editable. Renaming stays open (see race-rename).

A paid race is locked from the first of: the runner's first accepted ping recorded at or after the race start, or 48 hours after the race start. An unpaid race is never locked. While locked by a ping, the start can still move within 12 hours of that ping (a delayed gun). A refused save is shown as the same sentence: a queued course upload the server refuses is dropped with it, not retried.

## API
The room carries `raceLockedAt` (GET /race-rooms/:roomId, GET /race-rooms/mine): the effective lock, absent when unlocked. Client-core `RaceLock.isLocked(room)` and `RaceSummary.isRaceLocked` read it. A refused PUT /race-rooms/:roomId/course, PUT /race-rooms/:roomId/map-workspace or PATCH /race-rooms/:roomId/race-start answers 409 `{ code: "race_locked" }`, which client-core maps to `UserFacingError` code `race_locked` with `RaceLock.message`. POST /race-rooms/:roomId/course/gpx-preview stays open because it saves nothing.

## Permissions
none

## Success
Your race has started, so its course and start time are locked. You can still rename it and edit aid stations.

## Empty
Choose a route file.

## Error
Couldn't read the route file.

## Offline
Offline. The file stays on this device until upload.

## Accessibility labels
- crewcue.course-locked

## Native SDK pocket
none
