# room-members

## Entry
crewcue://dev/room-members

## Action
Open the roster, edit a display name, or remove a member when permitted.

## API
GET /race-rooms/:roomId memberships. PATCH and DELETE /race-rooms/:roomId/members/:memberUserId

## Permissions
none

## Success
Roster lists members.

## Empty
No members yet.

## Error
Couldn't update members.

## Offline
Offline. Roster not updated.

## Accessibility labels
- crewcue.room-members

## Native SDK pocket
none
