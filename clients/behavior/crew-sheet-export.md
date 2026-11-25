# crew-sheet-export

## Entry
crewcue://dev/crew-sheet-export

## Action
From Pace, share a plaintext crew sheet built on device from the loaded schedule. Each stop shows its checkpoint's title, a checkpoint added on the map included, never its id.

## API
none. Uses the schedule already on device.

## Permissions
none

## Success
A table of stops with due time and race time, built on device. Share sends the same sheet as text, headed by the race name.

## Empty
No schedule yet. Import the course file to build one.

## Error
Couldn't build the crew sheet.

## Offline
Offline. Crew sheet is ready to share from this device.

## Accessibility labels
- crewcue.crew-sheet-export

## Native SDK pocket
none
