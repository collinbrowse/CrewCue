# race-rename

## Entry
crewcue://dev/race-rename

## Action
Profile, Race & crew, Rename race. The row opens a dialog that edits the race's current name with a text field, Cancel and Save (iOS: an alert; Android: a dialog). Save sends the trimmed name. The race list and the top bar show the new name at once. Crew see it on their next race-list load. Only the runner, crew chiefs and team managers see the row (the API's `canEditRaceSetup`; client-core `PlanAuthority.mayEditRaceSetup`). Renaming stays open after the race has started (see course-locked).

## API
PATCH /race-rooms/:roomId `{ name }` through client-core `RaceDayAPI.renameRace`. The name is trimmed and 1 to 80 characters (`RaceName.validated`). The reply is the room shaped for the caller. `RaceRoster.rename` updates the race list without changing the active race.

## Permissions
none

## Success
Race renamed.

## Empty
Enter a race name of up to 80 characters.

## Error
Couldn't rename the race.

## Offline
Offline. Race name not changed.

## Accessibility labels
- crewcue.race-rename

## Native SDK pocket
none
