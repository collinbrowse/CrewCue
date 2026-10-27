# readouts-incidents

## Entry
crewcue://dev/readouts-incidents

## Action
List incidents for the room and submit a new one. Recommendation accept/reject is out of v1.

## API
GET and POST /race-rooms/:roomId/incidents

## Permissions
none

## Success
Lists incidents, or no open incidents when the list is empty of open items.

## Empty
No incidents.

## Error
Couldn't load incidents.

## Offline
Offline. Incidents not updated.

## Accessibility labels
- crewcue.readouts-incidents

## Native SDK pocket
none
