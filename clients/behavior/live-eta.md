# live-eta

## Entry
crewcue://dev/live-eta

## Action
The Pace timeline shows the server's live arrival for each stop still ahead ("ETA 14:20"), with the planned time beneath ("PLAN 13:50"). An arrival window shows only when the server sends one. The header shows the finish ETA. ETAs come from the server's projection of the runner's pings, so every crew phone shows the same times. When the server marks the projection degraded, the ETAs stay visible and are marked "old ping".

## API
GET /race-rooms/:roomId/projection

## Permissions
none

## Success
Finish ETA 14:20

## Empty
No Finish ETA row; the timeline shows planned times only.

## Error
The last ETAs stay visible.

## Offline
The last ETAs stay visible, marked old ping once the server's projection is stale.

## Accessibility labels
- crewcue.live-eta
- crewcue.schedule-sheet

## Native SDK pocket
none
