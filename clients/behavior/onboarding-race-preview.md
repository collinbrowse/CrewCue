# onboarding-race-preview

## Entry
crewcue://dev/onboarding-race-preview

## Action
A replay of about 25 seconds on the runner's own course, with the real Map, Pace and Chat views fed by DemoRace. The dot moves and Last update resets. The finish time slips later. A dead zone reaches Last update 18 min ago, then the saved pings catch up. A crew message arrives. Skip is always available, and the replay ends on the paywall.

The Map draws the course from the line the replay's runner follows (the course's route line, else its checkpoints). The runner's trail and dot follow that line exactly: the path DemoRace serves runs along it (the line's own vertices, and a point at least every 100 m), never a straight chord between two pings that cuts across the course.

While the replay plays, the dot glides along the course from one ping to the next, and the trail grows behind it up to the dot. Paused, the dot holds at that moment. With Reduce Motion the dot doesn't glide: it steps to each new ping. The glide is the replay's only; on the race Map the dot is always the runner's latest ping.

The path chip (`crewcue.runner-track`) counts the runner's pings, as on a race, not the points the replay adds along the course between them: on the fixture race it reaches PATH · 25 POINTS by the last step.

Each beat says where to look: a bold line under the caption (`OnboardingCopy.replayFocus`, `crewcue.onboarding-race-preview.focus`) and a pulsing accent ring around the view it is about (held still under Reduce Motion / animations off). The replay's map draws terrain-style tiles in both appearances and keeps its camera on the runner's dot at street zoom, recentring when the dot nears the edge, so the dot is seen moving instead of under aid station names.

## API
GET /race-rooms/:roomId (once, to build the replay on the runner's own course; the app may pass the saved room body instead). Everything after that uses local demo data only.

## Permissions
none

## Success
Your crew sees this the moment your phone sends a ping.

## Empty
Add your course to see the replay on your own route.

## Error
Couldn't play the replay. Skip to unlock your race.

## Offline
Offline. The replay plays from the race saved on this phone.

## Accessibility labels
- crewcue.onboarding-race-preview

## Native SDK pocket
maplibre
