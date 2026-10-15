# schedule-sheet

## Entry
crewcue://dev/schedule-sheet

## Action
Open Pace for the joined room and read each stop's elapsed time and UTC clock. `?state=` only overlays fixture copy.

## API
GET /race-rooms/:roomId/schedule

## Permissions
none

## Success
Signed-in sheet lists API stops with duration and clock. Unauthenticated fixture shows Aid 1 and 1:10:00.

## Empty
No stops on this sheet.

## Error
Couldn't load the schedule.

## Offline
Offline. Schedule not updated. The last sheet stays readable on this device.

## Accessibility labels
- crewcue.schedule-sheet

## Native SDK pocket
none
