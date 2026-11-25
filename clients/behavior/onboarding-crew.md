# onboarding-crew

## Entry
crewcue://dev/onboarding-crew

## Action
The crew flow after the join. Joining is join-link and join-crew: a link or code, the preview, sign-up, then the automatic join through the device's pending invite (`PendingJoin`). Once the joined race is unlocked (paid), the tab bar opens with a tour of eight cards; an unpaid race shows "The runner hasn't unlocked this race yet." and no tour. Copy is client-core `OnboardingTourCopy`; the cards come from `OnboardingTour.card`.

Coach marks work as in onboarding-runner-tour: a ring on the card's tab from that control's real frame, the card beside it with room, the tab opened under it, "N of 8", Skip tour, and each answer saved for the crew tour so a relaunch, fold or rotation resumes on the same card.

The explanations use an example race (`CrewTourDemo`, from `DemoRaceFixture`), under "Example race": a runner named Ada at mile 13.0, a ping 4 min old, Aid 2 due 12 min after its plan, 2.5 mi ahead. They are never the real race's numbers; the real race behind the cards shows the runner's own pings, as every crew phone does. The crew phone is never asked for location.

1. Your runner's dot (Map): the dot is where the runner's phone last sent a ping. Example: Runner, Ada · Mile 13.0.
2. Last update (Map): how old the dot is, and saved pings arriving together after a dead zone. Example: Last update, 4 min ago.
3. ETA and PLAN (Pace): ETA at the pace so far, PLAN as planned. Example: Aid 2 ETA and PLAN clock times.
4. Planned stops (Pace): Edit planned stops changes how long the runner stops; every crew phone gets the new times.
5. Check in without service (Pace): check the runner in at the aid station when their phone has no service.
6. Directions to the next aid (Map): Navigate gives a route to the next aid station. Example: Next aid, Aid 2 · 2.5 mi ahead.
7. Chat and alerts (Chat): message the runner and crew; Settings (the gear) chooses chat alerts.
8. Turn on notifications (no tab): the system prompt and push registration; allowed saves it done, Not now skips it. Done ends the tour.

## API
The join: join-link and join-crew. The tour reads nothing new: the tabs behind it load the race as usual (GET /race-rooms/:roomId, /schedule, /pings/latest). Notifications: POST /push-registrations (through the outbox).

## Permissions
notifications

## Success
The dot is where Ada's phone last sent a ping. Every crew phone sees the same dot.

## Empty
Join your runner's race to start the tour.

## Error
Couldn't load the race. The tour uses an example race.

## Offline
Offline. The tour plays from an example race on this phone.

## Accessibility labels
- crewcue.onboarding-crew (the coach mark overlay)
- crewcue.onboarding.tour.<step> (runnerLocation, lastUpdateAge, etaVsPlan, editCheckpointDetails, checkInWhenNoService, directionsToNextAid, chatAndAlerts, notifications)
- crewcue.onboarding.tour.example (the example race lines)
- crewcue.onboarding.tour.primary, crewcue.onboarding.tour.secondary, crewcue.onboarding.tour.skip

## Native SDK pocket
push

## Proof
The dev link plays the eight cards with no account and no API. The real tour needs a signed-in crew member of a paid race (a dev session against the API).
