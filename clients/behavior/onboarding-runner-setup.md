# onboarding-runner-setup

## Entry
crewcue://dev/onboarding-runner-setup

## Action
The runner's phase 1 setup, in order. Account and display name. Course file: preview the GPX, then save it. Start time: a local date and time in a chosen zone; a time that does not exist because of daylight saving is refused. Training history: import a file or skip. Projection teaser: the finish ETA only, with every aid station row locked until the race is unlocked. Errors are shown under the step. Course save limit (429): "You've changed the course a lot this hour. Try again in a bit." Start time on a daylight saving gap (RaceStartInput.problem is daylightSavingGap): "That time doesn't exist on that date because of daylight saving. Pick another time." Race not unlocked: aid station times stay locked until you unlock the race. A course_mismatch recomputes the estimate with no message.

## API
POST /race-rooms, POST /race-rooms/:roomId/course/gpx-preview, PUT /race-rooms/:roomId/course, activity import (POST /activity-history/file), POST /pacing-estimates, PUT /race-rooms/:roomId/pacing-estimate, GET /race-rooms/:roomId/projection and GET /race-rooms/:roomId/schedule

## Permissions
none

## Success
Your finish time is ready. Aid station times unlock with your race.

## Empty
Add your course file to start. Training history is optional.

## Error
Couldn't save this step.

## Offline
Offline. Setup needs the network. Your answers stay on this phone until you reconnect.

## Accessibility labels
- crewcue.onboarding-runner-setup

## Native SDK pocket
none
