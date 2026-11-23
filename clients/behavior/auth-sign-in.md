# auth-sign-in

## Entry
crewcue://dev/auth-signed-out

## Action
Launch signed out and tap Sign in. Auth0 performs authorize. Sign-out wipes every per-user store. So does session expiry: any authorized API call answered 401 for the current token signs out. Signing in removes every other account's files, so a second account never sends the first account's queue.

Back: signed out, sign-in has a Back at the top leading edge (a chevron and the word Back, spoken "Back"), plus the platform's back gestures (iOS: the swipe from the leading edge and VoiceOver's escape; Android: system Back). It opens the app's own signed-out launch, the screen sign-out lands on: the chooser (or the step a saved pick resumes), with the onboarding state untouched. That holds however sign-in opened: the chooser's "I already have an account", join's Back, or this dev link with no chooser behind it. Cancelling Auth0's page returns to sign-in with Back there. "I already have an account" opens sign-in set to sign in, not sign up. Back is dimmed while Auth0 is working.

## API
Auth0 authorize. API calls then send Authorization Bearer.

## Permissions
none

## Success
Shows the signed-out state until Auth0 returns a session.

## Empty
No session.

## Error
Sign-in failed.

## Offline
Offline. Can't reach Auth0.

## Accessibility labels
- crewcue.auth-signed-out
- crewcue.auth-sign-in.back

## Native SDK pocket
auth0
