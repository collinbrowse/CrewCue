# unlock-reminder

## Entry
crewcue://dev/billing-purchase

## Action
The API reminds the creator of an unpaid race before the race is deleted 30 days after it was created: "will be deleted in N days" from day 23, "will be deleted tomorrow" from day 29, and "is in N days" once the race start is 3 days away and comes before the deletion. Each is sent once, only to the race's creator, never to other members, and never once the race is paid. Title "Unlock your race"; body for example "Your race Leadville 100 will be deleted in 7 days. Unlock it to keep your course and plan." Days are whole days rounded down, at least 1; the copy never shows a clock time. A newer reminder replaces an older one still on screen; none replaces a chat, schedule or tracking notification. The payload carries `type: "unlock"` and `roomId`. Tapping it switches to that race and opens its Race Pass paywall (push-tap); a race paid since opens its Map. With the app open, the banner still shows.

The runner's Unlock race banner on Map, Pace and Chat shows "Expires in N days" under it, from the race list's `unpaidExpiresAt` (whole days rounded down, at least 1, as the pushes count them). Without that date (paid, expired, or an older server) the banner shows Unlock race alone.

## API
None from the client for the push (unpaidRaceReminderScheduler.ts, APNs and FCM, to devices registered with POST /chat/push/tokens). GET /race-rooms/mine gives `unpaidExpiresAt` for the banner.

## Permissions
notifications

## Success
Unlock your race. Your race Leadville 100 will be deleted in 7 days. Unlock it to keep your course and plan. Banner: Unlock race, Expires in 7 days.

## Empty
No reminder: the race is paid, or the person isn't its creator.

## Error
Notifications are off. No reminder arrives; the banner still shows the days left.

## Offline
Offline. A reminder past its expiry (24 hours for the deletion warnings, the race start for "is in N days") is never shown. One still current arrives when the phone is back online.

## Accessibility labels
- crewcue.billing-purchase
- crewcue.unlock-race-banner

## Native SDK pocket
push

## Proof
Real phone only (`"proof": "physical"` in deeplinks.json): the timing, expiry and the creator-only delivery come from real APNs and FCM. The proof sets `deviceClass: "physical"`, and its `checked.Action` must cover:
- An unpaid race 23 days old on the runner's phone: the push arrives with the copy above; tapping it opens that race's paywall.
- The Unlock race banner shows "Expires in N days" matching the push.
- A crew phone in the same race gets no push.
- Paying, then tapping an older reminder: the race's Map, no paywall.
- Both with the app in the background and in the foreground.

## Today
iOS routes the tap (push-tap, simulator proof) and shows the days left on the banner; there is no real-phone proof yet. Android doesn't route `unlock` taps or show the days left yet (a later PR).
