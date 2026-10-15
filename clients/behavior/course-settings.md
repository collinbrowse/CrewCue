# course-settings

## Entry
crewcue://dev/course-settings

## Action
Read cutoff and stoppage from the loaded course and keep an on-device draft. This screen does not call stop-plan APIs.

## API
GET /race-rooms/:roomId for course checkpoint stoppage. Draft stays local.

## Permissions
none

## Success
Cutoff and stoppage saved as a draft.

## Empty
No course settings yet.

## Error
Couldn't save course settings.

## Offline
Offline. Course settings stay on this device.

## Accessibility labels
- crewcue.course-settings

## Native SDK pocket
none
