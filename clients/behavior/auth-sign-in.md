# auth-sign-in

## Entry
crewcue://dev/auth-signed-out

## Action
Launch signed out and tap Sign in. Auth0 performs authorize. Sign-out wipes every per-user store.

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
