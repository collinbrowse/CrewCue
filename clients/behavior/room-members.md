# room-members

## Entry
crewcue://dev/room-members

## Action
From Profile, open the roster or remove a member when permitted. Your own display name is edited in Settings.

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
