# onboarding-runner-tour

## Entry
crewcue://dev/onboarding-runner-tour

## Action
Runner phase 3: once the runner's race is unlocked (paid), the tab bar opens with a tour of five cards, in order. Copy is client-core `OnboardingTourCopy` and `LocationTestCopy`; which card shows comes from the onboarding state (`OnboardingTour.card`). An unpaid race keeps the paywall step open, so it gets no tour.

Coach marks: the screen dims and a ring sits on the tab the card is about (`crewcue.tab.*`), found from that control's real frame, never a screen edge. The card goes above or below the tab, whichever has room for it, else beside it (a bar down the side of a display), inside the margins and off the camera column. The card's tab opens under it. Every card has "N of 5" and Skip tour (not on the last card). Skip tour skips every card left; the location test then waits for race morning. Each card's answer is saved for the runner's tour, so a relaunch, a fold or a rotation resumes on the same card.

1. Invite your crew (Profile tab): Share invite opens the share sheet with the race's join link and code; then Next saves it done. Later skips it.
2. Turn on notifications (no tab): "We'll remind you to start tracking on race morning, and your crew's messages reach you." Turn on notifications shows the system prompt, then registers this phone for push (`PushRegistrationModel.register`); allowed saves it done, denied saves it skipped. Already allowed: "Notifications are on." and Next. Not now skips it.
3. Test tracking (Map tab), two options. Test tracking now starts tracking on this race: the system asks for When In Use, then Always; the first ping this phone gets to the server ends the test ("Test ping sent."), and tracking stops again unless it was already on. When the ping comes before the Always prompt is answered, tracking stays on up to 20 s for that answer. With When In Use only, the card asks for Always. The test's tracking session is marked with an end (the 45 s wait plus the 20 s Always window): if the app is gone before the test ends, tracking stops by itself then, and a real Start tracking replaces the mark. While the test runs, only the tracking itself ends it; the one sample the app takes when a race tab opens waits. Next saves it done. On race morning saves it for race morning (deferred) and stops a test that is running.
4. Your start line (Map tab): the map zooms to the course's start (a camera call next to the course framing). Next saves it.
5. Race chat (Chat tab): Done ends the tour.

Setup checklist card on Map (`SetupChecklistPolicy`), under the top bar once the tour is over, on the runner's own race only: "Race setup", "N of 5 done", the next open item, and Show all / Show less. Items: Invite your crew (done when the tour's invite was shared), Adjust aid station stops (opens Edit planned stops on Pace), Check your checkpoints (opens Place checkpoint on Map), Turn on notifications (done while the permission is on), Test tracking (done after the test ping or with Always allowed). Opening an optional item marks it done. Hide hides the card for this race. It goes when every item is done. The open list scrolls on a short display so the top bar stays.

Race progress on the cards' tabs still comes only from the runner's pings (the test ping included); the tour adds none.

## API
Invite: GET /race-rooms/:roomId. Notifications: POST /push-registrations (through the outbox). Location test: POST /race-rooms/:roomId/pings/batch, GET /race-rooms/:roomId/pings/latest.

## Permissions
notifications, location (When In Use, then Always)

## Success
Test ping sent. Your crew will see your dot. Tracking is off until you start it on race day.

## Empty
Unlock your race to start the tour.

## Error
Location is off for CrewCue. Turn it on in Settings, or test on race morning.

## Offline
Offline. The test ping is saved on this phone and goes when you're back online.

## Accessibility labels
- crewcue.onboarding-runner-tour (the coach mark overlay)
- crewcue.onboarding.tour.<step> (the card: invites, notifications, location, mapStartLine, chat)
- crewcue.onboarding.tour.primary, crewcue.onboarding.tour.secondary, crewcue.onboarding.tour.skip
- crewcue.onboarding.tour.location-status, crewcue.onboarding.tour.notifications-status
- crewcue.setup-checklist, crewcue.setup-checklist.toggle, crewcue.setup-checklist.hide, crewcue.setup-checklist.<item>

## Native SDK pocket
location

## Proof
The dev link plays the five cards on the example race with no API: every button moves on and nothing is saved or sent, except that Turn on notifications shows the system prompt. The real tour needs a signed-in runner with a paid race (a dev session against the API).
