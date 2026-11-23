# race-delete

## Entry
crewcue://dev/race-delete

## Action
Signed in, the entry opens Profile, where the delete controls are. The race's owner (the runner who created it) taps Delete race in Race & crew, or the trash button on that race's row in Your races. A confirm step names the race. On a paid race it first warns that the race's Race Pass is lost and can't be moved to another race or restored. Every confirm then points at the changes that don't need a delete (rename the race in Race & crew, or load a new course file in Pace, until the race starts), and says deleting removes the race for the whole crew and can't be undone. Delete race calls the API; Cancel changes nothing. Crew rows have no delete.

After the active race is deleted no race is active, and the app asks the person to choose: a "Race deleted" sheet lists their other races, then Create new race and Join race room. Map, Pace and Chat show the same choices ("Choose a race") until they pick one. The app never picks the next race for them. Deleting a race that isn't the active one only removes it from the list.

## API
DELETE /race-rooms/:roomId

## Permissions
none

## Success
The race leaves Your races. Deleting the active race shows the "Race deleted" chooser.

## Empty
With no other races, the chooser offers only Create new race and Join race room.

## Error
Couldn't delete the race. Try again. Only the runner can delete a race (403).

## Offline
Offline. Race not deleted.

## Accessibility labels
- crewcue.race-delete
- crewcue.race-chooser
- crewcue.no-race

## Native SDK pocket
none
