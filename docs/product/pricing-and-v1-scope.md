# Pricing and v1 scope

Decided 2026-11-09 with the owner. Goal: prove the app with paying runners before spending on services.

## Pricing

The runner pays per race. Crew members never pay.

| Product (store id) | Price | What it unlocks |
| --- | --- | --- |
| Race Pass (`race_pass`) | $14.99 | One race room: the runner plus **1** crew member |
| Full Crew upgrade (`crew_upgrade`) | +$9.99 | Unlimited crew on a room that already has a Race Pass |
| Race Pass + Full Crew (`race_pass_full_crew`) | $19.99 | Both at once ($5 cheaper than buying them one after the other) |

Why these numbers:

- **Per race, not a subscription.** Ultra runners race a few times a year, and the value lands on one weekend. The closest competitor that charges per race, Crewable, sells a Race Pass at $29 or $149 a year ([crewable.run](https://www.crewable.run/)). UltraCrew has a free tier (1 race, 2 crew) and a $12 per month Pro plan ([ultracrew.app/pricing](https://www.ultracrew.app/pricing)). $14.99 to $19.99 undercuts the per-race price and needs no commitment.
- **Unlimited crew, not tiers.** Every crew member installs the app, and crews are where the next runners come from. A cap on crew size taxes that growth loop. One upgrade is also one fewer store product to build and test.
- **The cap of 1 crew member** keeps the base price low. An upgrade at the moment a second person tries to join is a natural point to sell it.
- **Store fees.** Both stores take 15% under their small-business programs (Apple Small Business Program; Google's 15% rate on the first $1M a year). That leaves about $12.74 net from $14.99 and about $16.99 net from $19.99.
- Later, once there is purchase data: an annual "Season Pass" auto-renewing subscription for runners who race 3 or more times a year.

### Store rules that shape this

- **Purchases must go through Apple and Google in-app purchase.** A race room unlocks app features, so App Review Guideline 3.1.1 applies. The app may not unlock paid features with its own discount codes or license keys.
- **Products are consumables.** A runner buys one per race. The server records the purchase against the room, so nothing needs restoring after a reinstall.
- **RevenueCat** handles receipts, webhooks and both stores. It is free up to $2,500 monthly tracked revenue, then 1% (reported by third-party pricing summaries; check [revenuecat.com/pricing](https://www.revenuecat.com/pricing) before signing up).

### Discount codes, and how beta testers get it free

- **Beta testers need no code.** Purchases in TestFlight builds use Apple's sandbox and cost nothing. On Google Play, accounts listed as license testers get test purchases free. Beta testers simply buy the pass at no charge.
- **Free codes after launch (influencers, race directors, giveaways):**
  - **iOS:** Apple offer codes, which now cover consumables. Create them in App Store Connect, one-time-use or custom. The app shows Apple's redeem sheet (`AppStore.presentOfferCodeRedeemSheet`). Apple stopped issuing new in-app purchase promo codes on 2026-03-26, so offer codes are the only route ([Apple developer news](https://developer.apple.com/news/?id=gf6mgrs6)).
  - **Android:** Google Play promo codes for one-time products. The app links to the Play redeem page.
- **Comped rooms for a race director's whole field:** an admin-only API script marks a room paid. It is never typed into the app, so it stays outside the 3.1.1 rule.

## v1 scope: cut or replace anything that costs money

| Service | v1 decision | Why |
| --- | --- | --- |
| Stream Chat | **Replace with first-party crew chat** in the API: Postgres messages, polling or server-sent events, photos in object storage (Railway bucket), push through APNs and FCM directly | Removes a per-user vendor bill and a whole SDK on both clients |
| MapTiler (tiles, geocoding) | **Replace tiles with [OpenFreeMap](https://openfreemap.org)**: no key, no request limits, commercial use allowed. Drop place search for v1 (`geocode-search` is already deferred). | MapTiler's free plan does not cover a paid commercial app |
| Strava | **Cut from v1.** Keep GPX import and add FIT/TCX file import, which covers Garmin, COROS and Suunto exports. | Strava's API is free but starts at a 1-athlete cap until Strava reviews the app. Garmin paused new Connect API applications in 2026 and reopened with fees for larger apps ([the5krunner](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/)). COROS's partner API requires an established platform with a user base ([COROS](https://support.coros.com/hc/en-us/articles/17085887816340-Submit-an-API-Application)). Apply to both once there are users. |
| Auth0 | Keep (free plan) | Sign-in already works. Check the free plan's MAU limit when the production tenant is created. |
| Sentry | Keep (free Developer plan) | Crash reporting before external testers |
| RevenueCat | Keep (free under $2,500 a month) | See above |
| APNs, FCM | Keep (free) | Push |
| Railway | Keep (paid, small) | Hosting. Production and staging are separate environments in one project. |

## Launch backlog for agents (in order)

1. Runner background location (#562, PR #645).
2. In-app account deletion (#560) and the web deletion page.
3. Billing: RevenueCat on both clients, the three products, server entitlement (crew cap 1, then unlimited), RevenueCat webhook, offer and promo code redemption, admin comp script.
4. First-party crew chat replaces Stream. Push delivery through APNs and FCM (#563).
5. OpenFreeMap tiles. Remove the MapTiler key and the geocode route.
6. Remove Strava from v1 screens. Add FIT/TCX import next to GPX.
7. Make the iOS rows in `clients/behavior/deeplinks.json` that are still `fail` pass with device proof (auth-sign-in, athlete-setup, gpx-import, map-track, chat-thread and the rest), then Android.
8. Sentry on iOS, Android and the API (#564).
9. Legal and support pages (privacy, terms, support, account deletion) on GitHub Pages, linked from Settings (#569).
10. Hardening: secure token storage (#567), rate limits and headers (#565), readiness check and migration ledger (#566), pin Node to one LTS.
11. Projection leftovers: wire `hasHistory`, arrival-window bands.
