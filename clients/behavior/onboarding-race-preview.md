# onboarding-race-preview

## Entry
crewcue://dev/onboarding-race-preview

## Action
A replay of about 25 seconds on the runner's own course, with the real Map, Pace and Chat views fed by DemoRace. The dot moves and Last update resets. The finish time slips later. A dead zone reaches Last update 18 min ago, then the saved pings catch up. A crew message arrives. Skip is always available, and the replay ends on the paywall.

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
