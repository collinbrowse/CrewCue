# push-registration

## Entry
crewcue://dev/push-registration

## Action
In Settings, after permission, queue the device token for registration. Signed in, the entry deeplink opens Settings at This device and asks for permission. When notifications are already allowed, the app re-registers its token silently on each sign-in (tokens rotate). iOS sends `apnsEnvironment` ("development" for debug builds) so the API uses the matching APNs gateway; Android sends the FCM token. Tapping a chat push (`type: "chat"`, `roomId`) switches to that race and opens its chat. Signing out unregisters this phone's push device for the signed-out account, so its pushes stop reaching the phone; Android also deletes its FCM token. Sign-out never waits for it and finishes offline.

## API
POST /chat/push/tokens via the outbox (deviceId, platform, token, iOS apnsEnvironment). Device rows are keyed per user and device; a token registered by another account moves to that account. iOS tokens are APNs hex and Android tokens FCM-shaped, or the API answers 400. The API sends chat push straight to APNs and FCM and deletes tokens they reject. Sign-out: DELETE /chat/devices/:deviceId with the signed-out session's token, through client-core `PushDeviceUnregister` (runtime op `unregisterPushDevice` on Android), not queued; 204 removed, 404 none to remove (counts as removed).

## Permissions
notifications

## Success
The row shows On: "On. Check-ins, ETA changes and crew chat reach you, even with the app closed."

## Empty
This phone couldn't set up alerts. Try again.

## Error
Notifications are off for CrewCue. Turn them on in Settings.

## Offline
Offline. Alerts start once this phone is back online.

## Accessibility labels
- crewcue.push-registration

## Native SDK pocket
push
