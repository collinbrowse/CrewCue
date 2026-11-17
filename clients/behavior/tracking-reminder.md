# tracking-reminder

## Entry
crewcue://dev/location-heartbeat

## Action
The API reminds a runner who hasn't started tracking: one push 45 minutes before the race start and one 5 minutes before. Paid races only. Not tracking means the runner's phone has no accepted location ping recorded since 60 minutes before the start; a pre-start test ping counts as tracking. Only the runner's phones get it, never the crew's. Title "Start tracking"; body "Your race starts in 45 minutes. Start tracking so your crew can follow you." (5 minutes for the second). The minutes are counted from when it is sent, never a clock time. Each reminder is sent once. Moving the race start sends them again for the new start. A reminder whose window (T-45 to T-40, T-5 to the start) passed while the API was down is skipped. The payload carries `type: "tracking"` and `roomId`. Tapping it switches to that race and opens Start tracking (the location-heartbeat screen, this row's entry). With the app open, the banner still shows.

This row has no screen of its own: its entry is the screen the tap opens, so the device smoke tests that open every row's entry keep passing until the apps route the push.

## API
None from the client. The API sends the push (trackingReminderScheduler.ts, APNs and FCM) to devices registered with POST /chat/push/tokens.

## Permissions
notifications

## Success
Start tracking. Your race starts in 45 minutes. Start tracking so your crew can follow you.

## Empty
No reminder: the runner is already tracking, the race is unpaid or has started.

## Error
Notifications are off. No reminder arrives.

## Offline
Offline. The reminder arrives when the phone is back online, if the platform still holds it.

## Accessibility labels
- crewcue.location-heartbeat

## Native SDK pocket
push

## Proof
Real phone only (`"proof": "physical"` in deeplinks.json): simulators and emulators don't receive these APNs and FCM pushes. The proof sets `deviceClass: "physical"`, and its `checked.Action` must cover:
- A paid race starting in about 50 minutes, the runner signed in with notifications allowed and not tracking. The T-45 push arrives with the copy above; tapping it opens that race at Start tracking.
- Start tracking before T-5: no T-5 push arrives.
- A crew phone in the same race gets neither push.
- Both with the app in the background and in the foreground.

## Today
Neither app routes `type: "tracking"` yet. iOS shows the banner, but a tap opens the app where it was (`PushRouter` takes only `chat`). Android shows the system notification only while the app is in the background, where a tap opens the shell's Map tab; in the foreground the message is dropped (`CrewCueMessagingService` shows only `chat`).
