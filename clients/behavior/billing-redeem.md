# billing-redeem

## Entry
crewcue://dev/billing-redeem

## Action
The runner taps Redeem code on an unpaid race. iOS shows Apple's offer code sheet (`AppStore.presentOfferCodeRedeemSheet`); Android opens the Google Play redeem page (`https://play.google.com/redeem?code=`). A redeemed code arrives as a store purchase through RevenueCat, so the app then polls the room's billing until it unlocks. No CrewCue code is ever typed into the app (App Review 3.1.1). Debug builds show the store step as a fake redemption.

## API
Apple offer code sheet or Google Play redeem page, then GET /race-rooms/:roomId/billing (poll)

## Permissions
none

## Success
Code redeemed. Unlocking your race.

## Empty
Have a code? Redeem it with the App Store or Google Play.

## Error
Couldn't open code redemption.

## Offline
Offline. Redeeming a code needs the network.

## Accessibility labels
- crewcue.billing-redeem
- crewcue.billing-redeem.open

## Native SDK pocket
revenuecat
