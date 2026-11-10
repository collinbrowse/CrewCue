# billing-purchase

## Entry
crewcue://dev/billing-purchase

## Action
The runner creates a race and buys a Race Pass ($14.99, runner + 1 crew) or Race Pass + Full Crew ($19.99, unlimited crew) through the App Store or Google Play. The app sets the RevenueCat attribute `crewcue_room_id` to the room before buying, then polls the room's billing until the server (RevenueCat webhook) unlocks it. Debug builds buy through the fake purchaser (`POST /race-rooms/:roomId/billing/dev-purchase`); `?webhookDelay=<seconds>` on the deeplink delays the fake webhook to prove the poll.

## API
GET /race-rooms/:roomId/billing (poll), store purchase via RevenueCat (`race_pass`, `race_pass_full_crew`), server-side POST /billing/revenuecat

## Permissions
none

## Success
Unlocked: you plus 1 crew member.

## Empty
No Race Pass yet. Buy one to open this race.

## Error
Couldn't complete the purchase.

## Offline
Offline. Purchases need the network.

## Accessibility labels
- crewcue.billing-purchase
- crewcue.billing-purchase.buy-pass
- crewcue.billing-purchase.buy-full-crew
- crewcue.billing-purchase.status

## Native SDK pocket
revenuecat
