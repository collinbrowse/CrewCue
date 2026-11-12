# account-deletion

## Entry
crewcue://dev/account-deletion

## Action
In Settings → Account, tap Delete account. A confirm step explains what is deleted and that races where you are the runner close for your whole crew. Delete account calls the API; on success the app signs out and wipes the session, outbox and per-user caches. Cancel changes nothing. A link opens the web deletion page from build config.

## API
DELETE /me

## Permissions
none

## Success
Account deleted; the app shows sign-in. The runner's races are gone for their crew.

## Empty
Confirm step: "Delete your account?" with the shared client-core copy, Delete account and Cancel.

## Error
Couldn't delete your account. Try again. (Still signed in.) A 502 shows: Your data was deleted, but we couldn't finish removing your login. Try again.

## Offline
You're offline. Your account was not deleted. (Still signed in.)

## Accessibility labels
- crewcue.account-deletion

## Native SDK pocket
auth0
