# join-crew

## Entry
crewcue://dev/join-crew

## Action
Enter a 6-digit code, preview the room, then join after sign-in.

The page opens fresh every time (no code or answer from the last visit; a pending invite is filled in again). Opened on its own (Profile's Join race room, a race-less tab, sign-in) it closes with an X at the top right (`crewcue.join-crew.close`), back to where it was opened; as onboarding's crew step it has onboarding's Back. The prompt "Enter the 6-digit code from your crew." is the only instruction while nothing is typed: the Empty line below is not repeated under it. The Paste invite code line shows only while the clipboard holds digits or a link (iOS) or text (Android, read from its description only). A race the runner hasn't unlocked answers 402 `room_unpaid`: the page shows "Waiting for the runner to unlock this race." as a waiting card (`crewcue.join-crew.waiting`), not an error, and keeps the code. The server still refuses the membership until the race is paid.

## API
GET /race-rooms/join-preview/:roomCode and POST /race-rooms/join-by-code

## Permissions
none

## Success
Invite code ready for preview, then membership on join.

## Empty
Enter an invite code.

## Error
That invite code was not found.

## Offline
Offline. Invite preview needs the network.

## Accessibility labels
- crewcue.join-crew

## Native SDK pocket
none
