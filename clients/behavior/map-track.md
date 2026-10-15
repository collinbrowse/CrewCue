# map-track

## Entry
crewcue://dev/map

## Action
Open the Map tab. MapLibre draws the course polyline and checkpoint titles.

## API
GET /race-rooms/:roomId course geometry

## Permissions
none

## Success
MapLibre shows the course. Fixture overlay names AID 1.

## Empty
No course on the map.

## Error
Couldn't load the map style.

## Offline
Offline. Map tiles are unavailable.

## Accessibility labels
- crewcue.map

## Native SDK pocket
maplibre
