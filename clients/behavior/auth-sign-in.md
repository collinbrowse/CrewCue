# auth-sign-in

## Entry
crewcue://dev/auth-signed-out

## Action
Launch signed out and tap Sign in. Auth0 performs authorize. Sign-out wipes every per-user store. So does session expiry: any authorized API call answered 401 for the current token signs out. Signing in removes every other account's files, so a second account never sends the first account's queue.

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

## Native SDK pocket
auth0
