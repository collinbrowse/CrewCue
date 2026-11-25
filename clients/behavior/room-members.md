# room-members

## Entry
crewcue://dev/room-members

## Action
From Profile, open the roster or remove a member when permitted. Your own display name is edited in Settings.

The runner's Invite pill sits on the CREW label's row at its trailing edge (`crewcue.room-members.invite`), not among the members, and shows before the race is paid. Room members and Incidents come in from the right over Profile with a Profile back control at the top (and system Back / VoiceOver escape). Invite crew opens as one dismissible sheet with an X on iOS, and as a page with its back control at the top and system Back on Android: no page reached from Profile is a dead end.

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
