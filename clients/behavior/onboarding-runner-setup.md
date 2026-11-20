# onboarding-runner-setup

## Entry
crewcue://dev/onboarding-runner-setup

## Action
The runner's phase 1 setup, in order. All copy is client-core `OnboardingCopy`.

Account: create an account or sign in, then the runner's own name. The field is labelled "Your name" with "Your crew sees this in chat." under it, and never starts with the email (`SuggestedDisplayName`).

Course: a "Race name" field comes first (placeholder "Western States 2026", help "Your race and the year, or a fun name for your crew."). Choose course file stays disabled until it is filled. The name is kept in the setup draft as it is typed. Picking the file creates the race with that name (`POST /race-rooms`). After that the name shows read-only, because the API has no rename. While the file is read and previewed, and until the map has drawn its first full frame with the elevation profile, the Cairn loader shows centred where the preview goes, with "Reading your course…". The map, summary and profile stay hidden under it. With Reduce Motion it shows the finished stack, no movement. The wait for the map ends after 8 seconds at most. A failed preview shows the error and Try again, with no loader. Then the course is saved with the start time.

Start time: a local date and time in a chosen zone; a time that does not exist because of daylight saving is refused.

Training history: the lead "CrewCue reads your pace on a past run, adjusted for its climbs, so your finish and aid station times fit how you run." and three tips: which run to pick (a recent race or long run the watch recorded), the formats the importer takes (.gpx, .fit or .tcx up to 10 MB, exported from a watch app), and that it is optional (Skip gives a rough estimate from the course alone; Settings > Past runs adds runs later). Import a file or skip.

Projection teaser: the finish ETA only, with every aid station row locked until the race is unlocked.

Back: the navigation bar's top-leading button (a chevron and "Back", spoken "Back") and the swipe from the leading edge open the previous step: teaser, history, start time, course, account. What was entered stays. From the account step they return to the chooser, and only while no race exists. Continue on a step reached with Back opens the next step until setup is back where it was. A start time that was already saved and left as it was moves on without saving the course again. A file picked after going back is saved with the start time; a relaunch before that reopens the course or start time step.

Errors are shown under the step. Course save limit (429): "You've changed the course a lot this hour. Try again in a bit." Start time on a daylight saving gap (RaceStartInput.problem is daylightSavingGap): "That time doesn't exist on that date because of daylight saving. Pick another time." Race not unlocked: aid station times stay locked until you unlock the race. A course_mismatch recomputes the estimate with no message.

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
- crewcue.onboarding.back (navigation bar, label "Back")
- crewcue.onboarding.display-name (label "Your name")
- crewcue.onboarding.race-name (the field, then the read-only name)
- crewcue.onboarding.course-loading (label "Reading your course…")
- crewcue.onboarding.history-tips

## Native SDK pocket
none
