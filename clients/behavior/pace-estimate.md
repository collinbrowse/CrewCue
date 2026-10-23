# pace-estimate

## Entry
crewcue://dev/pace-estimate

## Action
Athlete opens Pace after history changes and the client recomputes. Crew sees the estimate and may tap Recalculate, which is an explicit request, not an automatic one.

## API
POST /pacing-estimates then PUT /race-rooms/:roomId/pacing-estimate

## Permissions
none

## Success
Shows the attached plan-of-record estimate, or the cold-start copy when history is empty.

## Empty
No estimate yet.

## Error
Couldn't load the pace estimate.

## Offline
Offline. Estimate not updated.

## Accessibility labels
- crewcue.pace-estimate

## Native SDK pocket
none
