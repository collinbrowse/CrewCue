# athlete-setup

## Entry
crewcue://dev/athlete-setup

## Action
Enter a display name and save it on this device, then sync when signed in.

## API
PATCH /race-rooms/:roomId/members/:memberUserId with displayName

## Permissions
none

## Success
Athlete profile saved on this device.

## Empty
Name is required.

## Error
Couldn't save athlete setup.

## Offline
Offline. Setup will sync when the network returns.

## Accessibility labels
- crewcue.athlete-setup

## Native SDK pocket
none
