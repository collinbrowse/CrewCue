# cold-start

## Entry
crewcue://dev/cold-start

## Action
Open Pace when the room has no usable history. Crew may seed this cold start. Only the athlete may auto-recompute later.

## API
POST /pacing-estimates with roomId when history is empty

## Permissions
none

## Success
Cold start: no history yet. Coarse estimate only.

## Empty
No estimate yet.

## Error
Couldn't load the pace estimate.

## Offline
Offline. Estimate not updated.

## Accessibility labels
- crewcue.cold-start

## Native SDK pocket
none
