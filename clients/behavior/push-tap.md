# push-tap

## Entry
crewcue://dev/app-shell

## Action
Tapping a CrewCue notification opens what it is about, on its race. The payload carries `type` and `roomId` (APNs beside `aps`, FCM in `data`; `chatPushTransports.ts`). client-core `PushTapRoute` reads it and `PushTapInbox` holds it; the apps only map the answer onto their navigation.
- `chat`, or no `type`: that race's Chat.
- `tracking` (tracking-reminder): that race's Map at Start tracking (the location-heartbeat panel). A race the person doesn't run opens its Map.
- `unlock` (unlock-reminder): that race's Race Pass paywall. A race already paid, or one the person doesn't own, opens its Map.
A tap on another race than the active one makes it the active race first. The settings sheet closes. The tap works from a cold launch, from the background, and with the app open (the banner still shows in the foreground). A newer tap replaces one still waiting.
Signed out, the tap is held in memory until someone signs in during this launch, then resolved against that account's races; it never outlives the launch, and sign-out clears a held tap. A race the loaded list doesn't have waits for the next race-list answer; if that list doesn't have it either, the tap is dropped, so another account's push never opens a race the person can't read.

## API
GET /race-rooms/mine (only when the tapped race isn't in the loaded list). The pushes come from dispatchChatPush (chat, tracking, unlock).

## Permissions
notifications

## Success
Unlock your race tapped with the app open: the Leadville 100 Race Pass paywall. Start tracking tapped from the background: Western States Map with the Tracking panel and Start tracking. Unlock for a paid race: its Map.

## Empty
A kind this build doesn't route (`schedule`, anything newer) or no `roomId`: the app opens where it was.

## Error
A race not in the person's list (another account's push, a race left or deleted): the app opens where it was and the tap is dropped.

## Offline
A race already in the loaded list opens offline. One that isn't waits for the next race-list answer.

## Accessibility labels
- crewcue.app-shell
- crewcue.billing-purchase
- crewcue.location-heartbeat
- crewcue.top-bar-title

## Native SDK pocket
push

## Proof
Simulator: `xcrun simctl push <udid> com.crewcue.ios <file>.apns` with the API's payload, then tap the banner. A local memory API seeds the person's paid and unpaid races and another account's race. Emulator: `adb shell am start -n com.crewcue.android/.MainActivity --es type <kind> --es roomId <id>`, the extras a system-shown FCM notification carries.

## Today
iOS and Android route chat, tracking and unlock taps (simulator and emulator proof). Android reads the FCM `data` keys from the launch intent's extras (cold launch and `onNewIntent`) and asks client-core through the `pushTapReceive` and `pushTapTake` runtime ops; in the foreground `CrewCueMessagingService` shows every kind with the same extras on its tap.
