# billing-upgrade

## Entry
crewcue://dev/billing-upgrade

## Action
A paid room on the Race Pass tier has its one crew seat taken. A second crew member who joins by code gets the crew-limit refusal; the runner's Room members screen shows the Full Crew upgrade ($9.99) and buys it. Every member's next billing read shows unlimited crew, and the refused crew member can join.

## API
POST /race-rooms/join-by-code (409 `crew_limit_reached`), GET /race-rooms/:roomId/billing, store purchase via RevenueCat (`crew_upgrade`)

## Permissions
none

## Success
Unlocked: unlimited crew.

## Empty
Race Pass: you plus 1 crew member (1 of 1 joined).

## Error
This race is full. Ask the runner to add Full Crew so more crew can join.

## Offline
Offline. Purchases need the network.

## Accessibility labels
- crewcue.billing-upgrade
- crewcue.billing-upgrade.buy
- crewcue.billing-upgrade.status

## Native SDK pocket
revenuecat
