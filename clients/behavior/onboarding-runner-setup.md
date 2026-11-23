# onboarding-runner-setup

## Entry
crewcue://dev/onboarding-runner-setup

## Action
The runner's phase 1 setup, in order. All copy is client-core `OnboardingCopy`.

Account: create an account or sign in, then the runner's own name. The field is labelled "Your name" with "Your crew sees this in chat." under it, and never starts with the email (`SuggestedDisplayName`).

Course: a "Race name" field comes first (placeholder "Western States 2026", help "Your race and the year, or a fun name for your crew."). Choose course file stays disabled until it is filled. The name is kept in the setup draft as it is typed. Picking the file creates the race with that name (`POST /race-rooms`). After that the name shows read-only, because the API has no rename. A race is never named after its course file: with no name typed, a race made on another phone (or one that is gone and made again) takes the race list's name, and with neither the step shows "Add a race name to continue." with the name field open; Try again waits for the name like Choose course file. While the file is read and previewed, and until the map has drawn its first full frame with the elevation profile, the Cairn loader shows centred where the preview goes, with "Reading your course…". The map, summary and profile stay hidden under it. With Reduce Motion it shows the finished stack, no movement. The wait for the map ends after 8 seconds at most, counted per preview. A preview restored after a relaunch waits for its map under the loader with no caption (spoken "Loading"). A failed preview shows the error and Try again, with no loader. Then the course is saved with the start time.

Start time: a local date and time in a chosen zone; a time that does not exist because of daylight saving is refused.

Training history: the lead "CrewCue reads your pace on a past run, adjusted for its climbs, so your finish and aid station times fit how you run." and three tips: which run to pick (a recent race or long run the watch recorded), the formats the importer takes (.gpx, .fit or .tcx up to 10 MB, exported from a watch app), and that it is optional (Skip gives a rough estimate from the course alone; Settings > Past runs adds runs later). Import a file or skip.

Projection teaser: the finish ETA only, with every aid station row locked until the race is unlocked.

Back: the navigation bar's top-leading button (a chevron and "Back", spoken "Back"), the swipe from the leading edge and VoiceOver's escape open the previous step: teaser, history, start time, course, account. What was entered stays. From the account step they return to the chooser, and only while no race exists (on the dev link, to the app's own launch). Continue on a step reached with Back (or reopened by a relaunch) opens the next step until setup is back where it was, and saves only what changed (client-core `RunnerSetupSteps`):

- Course: a phone that doesn't hold the file (signed out and back in, another phone, a reinstall) shows "Course saved" (with the file's name when known) and Continue, and uploads nothing. The same file picked again isn't saved again (its content is compared). A file picked after going back replaces the course only once it previews; one that can't be read shows the error with Try again and Cancel, and Cancel keeps the course from before.
- Start time: it shows the race's saved start (`raceStartAt`) when this phone never picked one. Left as saved, Continue moves on with no request and no course file. A start-only change is saved with `PATCH /race-rooms/:roomId/race-start`, which moves the estimate with the start. The course goes with the start (`PUT /course`) only when a new file was picked or the race has no course; that save drops the estimate, so the history step runs again, after a relaunch too.
- History: Continue always shows, and keeps the race's estimate unless a course save dropped it or a run was imported on this visit. Skip still replaces it with a rough estimate.
- History on a phone with no setup progress for the race (a reinstall, cleared app data, another phone, a sign-in on a new device): progress is kept per phone, so setup opens the history step again even though the race already has a course, a start and an estimate. When the race list shows an estimate on the race (`pacingEstimateId`), Continue shows there too, keeps that estimate with no request, and marks the step done on this phone, so setup doesn't open it again. Skip still replaces it with a rough estimate, and a run imported on this visit computes a new one. With no estimate on the race, the step offers Import and Skip, as on a first visit.

A relaunch reopens the step that still has something to save: a file picked after going back (the course step, or the start time once its preview was confirmed), a start edited and not saved, or a history step whose estimate a course save dropped. It checks again when a fresh race list arrives, until it has reopened a step or the runner moves.

Errors are shown under the step. Course save limit (429): "You've changed the course a lot this hour. Try again in a bit." Start time on a daylight saving gap (RaceStartInput.problem is daylightSavingGap): "That time doesn't exist on that date because of daylight saving. Pick another time." Race not unlocked: aid station times stay locked until you unlock the race. A course_mismatch recomputes the estimate with no message.

## API
POST /race-rooms, POST /race-rooms/:roomId/course/gpx-preview, PUT /race-rooms/:roomId/course, PATCH /race-rooms/:roomId/race-start, activity import (POST /activity-history/file), POST /pacing-estimates, PUT /race-rooms/:roomId/pacing-estimate, GET /race-rooms/:roomId/projection and GET /race-rooms/:roomId/schedule

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
- crewcue.onboarding.course-loading (label "Reading your course…" while a picked file is read, else "Loading")
- crewcue.onboarding.course-saved (label "Course saved", with the file's name when known)
- crewcue.onboarding.cancel-course (label "Cancel", after a file picked after Back couldn't be read)
- crewcue.onboarding.history-tips

## Native SDK pocket
none
