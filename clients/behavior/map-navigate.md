# map-navigate

## Entry
crewcue://dev/map-navigate

## Action
Choose a destination checkpoint and start a hike or drive route.

## API
POST /race-rooms/:roomId/routing/route

## Permissions
none

## Success
Navigate. Distance to the next aid is shown.

## Empty
No destination.

## Error
Couldn't start navigation.

## Offline
Offline. Navigation needs a route.

## Accessibility labels
- crewcue.map-navigate

## Native SDK pocket
maplibre
