# profile

## Entry
crewcue://dev/profile

## Action
Open Profile to see the signed-in name, race progress, the roster, and incidents. Sign out, display name, and Strava live in Settings.

Your races lists every race the user belongs to, with their role in each. One user can be the runner in some races and crew in others. Roles show as people read them: Runner, Crew member, Crew chief, Team manager. Wire values such as `crew_member` never reach the screen. Labels come from client-core `RaceRole.label`. Tapping a race makes it active. Map, Pace, Chat, Profile, and the settings sheet's display name and chat alerts then follow that race. Role and display name come from the user's membership in the selected room. The active race stays active across launches while the server still lists it. When the server no longer lists it, the first listed race becomes active. Creating or joining a race adds it to the list and makes it active.

## API
Session from Auth0. Sign-out wipes user stores. Display name uses PATCH members. The race list is GET /race-rooms/mine through client-core `RaceDayAPI.myRaces` (runtime op `myRaces` on Android). `RaceRoster` picks the active race. Per-room caches and drafts live under `RoomStorage.directory`. The outbox keys rows by room.

## Permissions
none

## Success
Signed-in profile.

## Empty
Display name is empty. With no races: No races yet.

## Error
Couldn't load profile. Race list: Couldn't load your races.

## Offline
Offline. Profile not updated. Race list: Offline. Showing your last race.

## Accessibility labels
- crewcue.profile
- crewcue.race-switcher
- crewcue.race-switcher.<roomId>

## Native SDK pocket
none
