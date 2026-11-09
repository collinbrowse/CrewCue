# runner-track

## Entry
crewcue://dev/runner-track

## Action
Every crew phone reads the runner's path from the API every 30 seconds while the app is open, and again when it returns to the foreground. Each read fetches only points after the last one it has. The map draws the path as a second line over the course, with a dot at the runner's latest position. A refresh never moves the camera. The path comes only from the runner's phone; a crew phone's own location is never drawn.

## API
GET /race-rooms/:roomId/pings/track

## Permissions
none

## Success
PATH · 12 POINTS

## Empty
NO PATH YET

## Error
The last path stays drawn and the ping chip ages to stale.

## Offline
The last path stays drawn; new points appear after the connection returns.

## Accessibility labels
- crewcue.runner-track
- crewcue.map

## Native SDK pocket
maplibre
