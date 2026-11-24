# join-link

## Entry
crewcue://dev/join-link

## Action
Open a crew invite link: the join page `https://collinbrowse.github.io/crewcue/join/?code=<code>` (a Universal Link or Android App Link once the site's association files verify), `crewcue://join/<code>` (the join page's Open CrewCue button), or the Play install referrer. Release builds accept these; only `crewcue://dev/*` stays Debug-only. The code is saved as the device's pending invite (`PendingJoin`) and the join screen opens with it, with the race's preview: "You're joining <runner>'s race". Signed out, Sign up to join confirms the invite and opens sign-up; a sign-in within 30 minutes of that (`OnboardingProgress.confirmedInviteLifetime`) joins the race on its own and opens it; later, or after Back, signing in joins nothing and the preview shows again. Signed in, Join joins it. A Paste invite code control reads a link, the share text, or the bare code from the clipboard. Back gives the invite up (the code and the confirmation).

## API
GET /race-rooms/join-preview/:roomCode (no session), then GET /race-rooms/mine and POST /race-rooms/join-by-code (`PendingJoinStore.resolve` after sign-in, or Join)

## Permissions
none

## Success
You're joining Sam's race. After sign-in the app joins it and opens the race.

## Empty
That link didn't include an invite code. Paste it or type the 6 digits.

## Error
That invite code was not found. A full race: This race is full. Ask the runner to add Full Crew so more crew can join. A race not unlocked yet: The runner hasn't unlocked this race yet. Full and locked keep the code for a retry.

## Offline
Offline. Joining a race needs the network. The code stays saved.

## Accessibility labels
- crewcue.join-link
- crewcue.join-crew
- crewcue.join-crew.preview
- crewcue.join-crew.paste
- crewcue.join-crew.race-full

## Native SDK pocket
none
