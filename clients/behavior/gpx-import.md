# gpx-import

## Entry
crewcue://dev/gpx-import-progress

## Action
Choose a GPX file. The server parses it. The client then saves the returned course. On a race that has started, GPX import shows the lock sentence instead (see course-locked).

## API
POST /race-rooms/:roomId/course/gpx-preview then PUT /race-rooms/:roomId/course

## Permissions
none

## Success
Calculating race splits… then the course is saved.

## Empty
The race's .gpx route. Sets the aid stations and schedule.

## Error
Couldn't read the route file.

## Offline
Offline. The file stays on this device until upload.

## Accessibility labels
- crewcue.gpx-import

## Native SDK pocket
none
