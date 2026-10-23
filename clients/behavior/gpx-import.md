# gpx-import

## Entry
crewcue://dev/gpx-import-progress

## Action
Choose a GPX file. The server parses it. The client then saves the returned course.

## API
POST /race-rooms/:roomId/course/gpx-preview then PUT /race-rooms/:roomId/course

## Permissions
none

## Success
Calculating race splits… then the course is saved.

## Empty
Choose a route file.

## Error
Couldn't read the route file.

## Offline
Offline. The file stays on this device until upload.

## Accessibility labels
- crewcue.gpx-import

## Native SDK pocket
none
