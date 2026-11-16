# Account deletion (#560)

App Store guideline 5.1.1(v) and Google Play both require that a user who can create an account can delete it from inside the app. Play also needs a web URL for deletion (see [readiness.md](readiness.md), needs-you item 7; the page is #569).

## What the user does

Settings → **Delete account** → confirm. The app calls `DELETE /me`, then signs out and clears its local caches (session, outbox, schedule cache). If the call fails the user stays signed in and can try again.

## What `DELETE /me` removes

| Data | What happens |
| --- | --- |
| Rooms where the user is the runner (`room.athleteId`) | **The room closes for everyone.** Room, invites, join code, task board, live ping/projection state, location track, WS4/WS5 state, snapshots, event log, chat notification prefs, the Stream channel, the finished-effort record and the course-history record made from it are all deleted. Crew members lose the room; its links return 404. |
| Rooms someone else runs | The user's membership is removed. Invites they sent, accepted or were addressed to are deleted. Their entries in the room's event log are re-attributed to `deleted-account`. The room keeps working for everyone else. |
| Activity history (Strava + GPX), pacing estimates, finished efforts | Deleted. |
| Push devices, chat notification prefs | Deleted. |
| Strava | The grant is revoked at Strava (best effort), then tokens and any pending OAuth state are deleted. |
| Stream chat user | Hard-deleted, messages marked deleted (when `STREAM_API_KEY`/`STREAM_API_SECRET` are set). |
| Auth0 user | Deleted through the Management API (when configured, below). This runs last. If it fails the API returns `502` with `retryable: true`; every step is idempotent, so the retry finishes the job. |

Why the runner's room closes rather than passing to the crew: the room is the runner's race. Its course, plan and location trail are the runner's personal data, and nobody else can drive its progress (see the runner-progress invariant in `AGENTS.md`).

Deletion is immediate; there is no grace period or restore. Logs: one `account_deleted` line with a hashed subject and counts. The request's audit line also carries only the hash.

`GET /me/export` returns the user's rooms, activity history, pacing estimates and Strava connection status as JSON.

## Owner config (Railway)

Not set by agents. In the Auth0 dashboard:

1. Applications → Create Application → **Machine to Machine** (name it e.g. "CrewCue API account deletion").
2. Authorize it for the **Auth0 Management API** with only the `delete:users` permission.
3. Set these on the Railway API service (staging first, then production):

| Variable | Value |
| --- | --- |
| `AUTH0_MGMT_DOMAIN` | Tenant domain, e.g. `crewcue.us.auth0.com` (not the custom login domain) |
| `AUTH0_MGMT_CLIENT_ID` | The M2M app's client ID |
| `AUTH0_MGMT_CLIENT_SECRET` | The M2M app's client secret |

Without them, deletion still removes all CrewCue data and returns `identityProvider: "not_configured"` (logged as a warning). The Auth0 login itself survives, so signing in again creates an empty account.

## Web deletion link

The apps read the web deletion URL from build config (`ACCOUNT_DELETION_URL`, default `https://crewcue.app/delete-account`) and show it under the delete button. The page itself, and the privacy-policy text describing this table, are #569. Record the final URL in [readiness.md](readiness.md) and in the Play Data safety form.
