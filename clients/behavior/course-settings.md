# course-settings

## Entry
crewcue://dev/course-settings

## Action
Race tools → Course shows the aid station stops and cutoffs for the race selected in Profile → Your races. When every aid station has the same planned stop, one sentence says so ("2 min planned at each of the 3 aid stations."); otherwise each stop is listed with its duration. Start and finish are left out. Cutoffs say how far ahead of each cutoff the runner is due ("Aid 2: 1 h 23 min ahead of the cutoff"). Read only: planned stops change through Edit planned stops on Pace.

## API
None directly. The runtime op `courseReadout` (requires `roomId`, optional `titles`) reads the schedule cached by GET /race-rooms/:roomId/schedule and formats it with client-core `RaceToolsCopy.courseReadout`.

## Permissions
none

## Success
2 min planned at each of the 3 aid stations. Use Edit planned stops on Pace to change it.

## Empty
No schedule yet. Import the course file to build one.

## Error
No schedule yet. Import the course file to build one.

## Offline
Offline. From the last schedule saved on this phone.

## Accessibility labels
- crewcue.course-settings

## Native SDK pocket
none
