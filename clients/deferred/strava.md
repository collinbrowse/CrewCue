# strava

> Deferred from v1 (#652): Strava connect is behind `ClientFeatureFlags.stravaEnabled` (off). v1 imports exported files instead; see `clients/behavior/activity-import.md`. Move this back to `clients/behavior/` and restore its `deeplinks.json` row when the flag turns on.

## Entry
crewcue://dev/strava

## Action
In Settings, connect or disconnect Strava. The return URL is crewcue://strava and reopens Settings at Strava.

## API
GET /strava/oauth/start, GET /strava/connection, DELETE /strava/connection

## Permissions
none

## Success
Shows whether Strava is connected.

## Empty
Strava is not connected.

## Error
Strava connection failed.

## Offline
Offline. Can't reach Strava.

## Accessibility labels
- crewcue.strava

## Native SDK pocket
auth0
