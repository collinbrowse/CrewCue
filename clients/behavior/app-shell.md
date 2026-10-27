# app-shell

## Entry
crewcue://dev/app-shell

## Action
Signed-in launch shows Map, Pace, Chat, and Profile. Each tab opens that feature. The gear on every tab opens Settings. Signed-out launch shows sign-in.

## API
none. Tabs select client routes.

## Permissions
none

## Success
Map Pace Chat Profile tabs switch features.

## Empty
Map Pace Chat Profile

Signed in with no race: Map, Pace, and Chat show "No race yet" with "Create new race" (opens Profile) and "Join race room" (opens join with a code). Profile still opens.

## Error
Couldn't open the shell.

## Offline
Offline. Shell is available on this device.

## Accessibility labels
- crewcue.app-shell
- crewcue.no-race

## Native SDK pocket
none
